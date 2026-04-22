import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireRole, ROLE_SETS, ROLES, AuthError, type SessionActor } from '../auth';
import { logActivity, notifyAssignmentStateChange, syncAssignmentArchive } from './shared';

type QaStage = 'QA1' | 'QA_FINAL';
type QaResult = 'approved' | 'rejected' | 'revision_requested';
type QaChecklistPayload = Record<string, { checked?: boolean; note?: string }>;

const QA_STAGE_ROLES = {
  QA1: ROLE_SETS.qaReviewer,
  QA_FINAL: ROLE_SETS.qaFinalReviewer,
};

const QA_EDITABLE_STATES: Record<QaStage, readonly string[]> = {
  QA1: ['1차QA대기', '1차QA진행중'],
  QA_FINAL: ['최종QA대기', '최종QA진행중'],
};

const QA_TRANSITIONS: Record<QaStage, Record<QaResult, string>> = {
  QA1: {
    approved: '최종QA대기',
    rejected: '1차QA반려',
    revision_requested: '수정요청',
  },
  QA_FINAL: {
    approved: '승인완료',
    rejected: '최종QA반려',
    revision_requested: '수정요청',
  },
};

function isQaStage(value: unknown): value is QaStage {
  return value === 'QA1' || value === 'QA_FINAL';
}

function isQaResult(value: unknown): value is QaResult {
  return value === 'approved' || value === 'rejected' || value === 'revision_requested';
}

function isQaCoordinator(role: string): boolean {
  return role === ROLES.CEO || role === ROLES.CTO || role === ROLES.OPS_MANAGER;
}

function canReviewQaAssignment(
  actor: SessionActor,
  assignment: { qa1_id: number | null; qa_final_id: number | null },
  stage: QaStage,
): boolean {
  const reviewerId = stage === 'QA1' ? assignment.qa1_id : assignment.qa_final_id;
  return reviewerId == null || reviewerId === actor.userId || isQaCoordinator(actor.role);
}

function normalizeQaChecklist(
  itemsJson: string,
  checklist: QaChecklistPayload | undefined,
): QaChecklistPayload {
  const parsed = JSON.parse(itemsJson) as Array<{
    id?: unknown;
    key?: unknown;
    required?: unknown;
  }>;
  if (!Array.isArray(parsed)) {
    throw new Error('체크리스트 템플릿 형식이 올바르지 않습니다.');
  }

  const source = checklist && typeof checklist === 'object' ? checklist : {};
  const normalized: QaChecklistPayload = {};
  const usedKeys = new Set<string>();
  for (const [index, item] of parsed.entries()) {
    if (!item) continue;
    const baseKey =
      typeof item.key === 'string' && item.key.trim()
        ? item.key.trim()
        : typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : `item-${index + 1}`;
    let key = baseKey;
    let duplicateIndex = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    usedKeys.add(key);
    const submitted = source[key];
    const checked = !!submitted?.checked;
    if (item.required && !checked) {
      throw new Error(`필수 QA 항목이 체크되지 않았습니다: ${key}`);
    }
    const rawNote = typeof submitted?.note === 'string' ? submitted.note.trim() : '';
    normalized[key] = rawNote
      ? { checked, note: rawNote.slice(0, 200) }
      : { checked };
  }
  return normalized;
}

export function registerBoardQaIpc() {
  // ===========================================================================
  // Operations board
  // ===========================================================================

  ipcMain.handle('board:summary', (event) => {
    requireRole(event, ROLE_SETS.assignmentReader);
    const db = getDb();
    const byState = db
      .prepare(
        `SELECT state, COUNT(*) AS n FROM assignments
          WHERE state NOT IN ('완료')
          GROUP BY state`,
      )
      .all() as Array<{ state: string; n: number }>;
    // SLA: anything past due_at AND not completed
    const overdue = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM assignments
            WHERE due_at IS NOT NULL
              AND datetime(due_at) < datetime('now')
              AND state NOT IN ('완료','승인완료','보류')`,
        )
        .get() as { n: number }
    ).n;
    const riskRows = db
      .prepare(
        `SELECT risk, COUNT(*) AS n FROM assignments
          WHERE state NOT IN ('완료','승인완료','보류')
          GROUP BY risk`,
      )
      .all() as Array<{ risk: string; n: number }>;
    const riskMap: Record<string, number> = { low: 0, medium: 0, high: 0 };
    for (const r of riskRows) riskMap[r.risk] = r.n;
    return { byState, overdue, risk: riskMap };
  });

  // ===========================================================================
  // QA checklists
  // ===========================================================================

  ipcMain.handle('qa:templates', (event, stage: QaStage) => {
    if (!isQaStage(stage)) {
      throw new Error('올바르지 않은 QA 단계입니다.');
    }
    requireRole(event, QA_STAGE_ROLES[stage]);
    const db = getDb();
    return db
      .prepare(
        `SELECT id, stage, name, items_json, version
           FROM checklist_templates
          WHERE stage = ? AND active = 1
          ORDER BY version DESC`,
      )
      .all(stage);
  });

  ipcMain.handle(
    'qa:submit',
    (
      event,
      payload: {
        assignmentId: number;
        stage: QaStage;
        reviewerId?: number;
        result: QaResult;
        checklist: QaChecklistPayload;
        comment?: string;
      },
    ) => {
      try {
        if (!isQaStage(payload?.stage)) {
          throw new Error('올바르지 않은 QA 단계입니다.');
        }
        if (!isQaResult(payload?.result)) {
          throw new Error('올바르지 않은 QA 결과입니다.');
        }
        const actor = requireRole(event, QA_STAGE_ROLES[payload.stage]);
        const assignmentId = Number(payload.assignmentId);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
          throw new Error('과제 ID가 올바르지 않습니다.');
        }

        const db = getDb();
        const nowIso = new Date().toISOString();
        const assignment = db
          .prepare(
            `SELECT id, state, qa1_id, qa_final_id
               FROM assignments
              WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(assignmentId) as
          | { id: number; state: string; qa1_id: number | null; qa_final_id: number | null }
          | undefined;
        if (!assignment) {
          throw new Error('과제를 찾을 수 없습니다.');
        }
        if (!QA_EDITABLE_STATES[payload.stage].includes(assignment.state)) {
          throw new Error(
            `${payload.stage === 'QA1' ? '1차 QA' : '최종 QA'} 제출 가능한 상태가 아닙니다.`,
          );
        }
        if (!canReviewQaAssignment(actor, assignment, payload.stage)) {
          throw new AuthError('forbidden', '이 과제의 QA 담당자가 아닙니다.');
        }

        const template = db
          .prepare(
            `SELECT items_json
               FROM checklist_templates
              WHERE stage = ? AND active = 1
              ORDER BY version DESC
              LIMIT 1`,
          )
          .get(payload.stage) as { items_json: string } | undefined;
        if (!template) {
          throw new Error('활성화된 QA 체크리스트가 없습니다.');
        }

        const checklist = normalizeQaChecklist(template.items_json, payload.checklist);
        const comment =
          typeof payload.comment === 'string' && payload.comment.trim()
            ? payload.comment.trim().slice(0, 1000)
            : null;
        const nextState = QA_TRANSITIONS[payload.stage][payload.result];
        const tx = db.transaction(() => {
          const update = db.prepare(
            `UPDATE assignments
                SET state = ?, updated_at = ?,
                    completed_at = CASE WHEN ? = '승인완료' THEN ? ELSE completed_at END
              WHERE id = ? AND state = ?`,
          ).run(nextState, nowIso, nextState, nowIso, assignmentId, assignment.state);
          if (update.changes === 0) {
            throw new Error('과제 상태가 변경되었습니다. 목록을 새로고침해 주세요.');
          }
          db.prepare(
            `INSERT INTO qa_reviews
               (assignment_id, stage, reviewer_id, result, checklist_json, comment)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            assignmentId,
            payload.stage,
            actor.userId,
            payload.result,
            JSON.stringify(checklist),
            comment,
          );
          // 최종 승인 → 보관함에 자동 추가 / 그 외 상태로 바뀌면 자동 레코드 제거
          syncAssignmentArchive(db, assignmentId, nextState, actor.userId);
        });
        tx();
        logActivity(db, actor.userId, 'qa.submit', `assignment:${assignmentId}`, {
          stage: payload.stage,
          result: payload.result,
          nextState,
        });
        // QA 결과를 다음 단계/담당자에게 통지 — 본 트랜잭션은 이미 커밋되었으므로
        // 알림 실패가 QA 결과를 롤백하지 않는다.
        notifyAssignmentStateChange(db, assignmentId, nextState, {
          comment,
          stage: payload.stage,
        });
        return { ok: true, nextState };
      } catch (err) {
        console.error('[ipc] qa:submit error', err);
        return { ok: false, error: (err as Error).message ?? 'submit_failed' };
      }
    },
  );


}
