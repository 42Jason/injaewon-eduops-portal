import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireActor, requireRole, ROLE_SETS, ROLES, AuthError } from '../auth';
import {
  logActivity,
  notifyAssignmentStateChange,
  recordDeletion,
  syncAssignmentArchive,
} from './shared';

export function registerAssignmentsIpc() {
  // -- assignments ------------------------------------------------------------
  ipcMain.handle(
    'assignments:list',
    (
      event,
      filter?: {
        state?: string;
        assignee?: number;
        search?: string;
        includeDeleted?: boolean;
        onlyDeleted?: boolean;
      },
    ) => {
      requireRole(event, ROLE_SETS.assignmentReader);
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.onlyDeleted) {
        where.push('a.deleted_at IS NOT NULL');
      } else if (!filter?.includeDeleted) {
        where.push('a.deleted_at IS NULL');
      }
      if (filter?.state) {
        where.push('a.state = ?');
        params.push(filter.state);
      }
      if (filter?.assignee) {
        where.push('(a.parser_id = ? OR a.qa1_id = ? OR a.qa_final_id = ?)');
        params.push(filter.assignee, filter.assignee, filter.assignee);
      }
      if (filter?.search) {
        const q = `%${filter.search}%`;
        where.push(
          '(a.code LIKE ? OR a.title LIKE ? OR a.subject LIKE ? OR a.student_code LIKE ?)',
        );
        params.push(q, q, q, q);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const rows = db
        .prepare(
          `SELECT a.id, a.code, a.subject, a.publisher, a.student_code, a.title,
                  a.scope, a.state, a.risk, a.parser_id, a.qa1_id, a.qa_final_id,
                  a.due_at, a.received_at, a.completed_at, a.deleted_at,
                  up.name AS parser_name, uq.name AS qa1_name, uf.name AS qa_final_name
             FROM assignments a
             LEFT JOIN users up ON up.id = a.parser_id
             LEFT JOIN users uq ON uq.id = a.qa1_id
             LEFT JOIN users uf ON uf.id = a.qa_final_id
             ${whereSql}
            ORDER BY a.due_at ASC, a.id DESC
            LIMIT 300`,
        )
        .all(...params);
      return rows;
    },
  );

  ipcMain.handle(
    'assignments:get',
    (event, payload: number | { id: number; includeDeleted?: boolean }) => {
      requireRole(event, ROLE_SETS.assignmentReader);
      const db = getDb();
      const id = typeof payload === 'number' ? payload : payload.id;
      const includeDeleted =
        typeof payload === 'number' ? false : !!payload.includeDeleted;
      const deletedGuard = includeDeleted ? '' : 'AND a.deleted_at IS NULL';
      const row = db
        .prepare(
          `SELECT a.*, up.name AS parser_name, uq.name AS qa1_name, uf.name AS qa_final_name
             FROM assignments a
             LEFT JOIN users up ON up.id = a.parser_id
             LEFT JOIN users uq ON uq.id = a.qa1_id
             LEFT JOIN users uf ON uf.id = a.qa_final_id
            WHERE a.id = ? ${deletedGuard}`,
        )
        .get(id);
      return row ?? null;
    },
  );

  // -- assignments CRUD (수동 추가 / 편집 / 소프트 삭제 / 복원 / 일괄) -----------
  const ASSIGNMENT_STATES = [
    '신규접수',
    '자료누락',
    '파싱대기',
    '파싱진행중',
    '파싱완료',
    '파싱확인필요',
    '1차QA대기',
    '1차QA진행중',
    '1차QA반려',
    '최종QA대기',
    '최종QA진행중',
    '최종QA반려',
    '승인완료',
    '수정요청',
    '완료',
    '보류',
  ] as const;
  const ASSIGNMENT_RISKS = ['low', 'medium', 'high'] as const;

  function nextAssignmentCode(db: ReturnType<typeof getDb>): string {
    interface MaxRow {
      max_num: number | null;
    }
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(CAST(SUBSTR(code, 3) AS INTEGER)), 0) AS max_num
           FROM assignments
          WHERE code LIKE 'A-%'`,
      )
      .get() as MaxRow;
    const next = (row?.max_num ?? 0) + 1;
    return `A-${String(next).padStart(4, '0')}`;
  }

  ipcMain.handle(
    'assignments:create',
    (
      event,
      payload: {
        actorId?: number | null;
        subject: string;
        title: string;
        studentId?: number | null;
        studentCode?: string | null;
        publisher?: string | null;
        scope?: string | null;
        lengthReq?: string | null;
        outline?: string | null;
        rubric?: string | null;
        teacherReq?: string | null;
        studentReq?: string | null;
        state?: string;
        risk?: string;
        parserId?: number | null;
        qa1Id?: number | null;
        qaFinalId?: number | null;
        dueAt?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        const db = getDb();
        if (!payload?.subject?.trim() || !payload?.title?.trim()) {
          return { ok: false, error: 'missing_required' };
        }
        const state = payload.state && ASSIGNMENT_STATES.includes(payload.state as typeof ASSIGNMENT_STATES[number])
          ? payload.state
          : '신규접수';
        const risk = payload.risk && ASSIGNMENT_RISKS.includes(payload.risk as typeof ASSIGNMENT_RISKS[number])
          ? payload.risk
          : 'low';

        // Resolve student_code — prefer explicit, fallback to students table lookup.
        let studentCode = payload.studentCode ?? null;
        if (!studentCode && payload.studentId) {
          const s = db
            .prepare('SELECT student_code FROM students WHERE id = ?')
            .get(payload.studentId) as { student_code: string } | undefined;
          studentCode = s?.student_code ?? null;
        }
        if (!studentCode) {
          // 필수 NOT NULL 이지만 학생 미연결일 수도 있음 → sentinel 값 사용
          studentCode = '-';
        }

        const code = nextAssignmentCode(db);

        const info = db
          .prepare(
            `INSERT INTO assignments (
                code, subject, publisher, student_id, student_code,
                title, scope, length_req, outline, rubric,
                teacher_req, student_req, state, risk,
                parser_id, qa1_id, qa_final_id, due_at
              ) VALUES (?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?)`,
          )
          .run(
            code,
            payload.subject.trim(),
            payload.publisher ?? null,
            payload.studentId ?? null,
            studentCode,
            payload.title.trim(),
            payload.scope ?? null,
            payload.lengthReq ?? null,
            payload.outline ?? null,
            payload.rubric ?? null,
            payload.teacherReq ?? null,
            payload.studentReq ?? null,
            state,
            risk,
            payload.parserId ?? null,
            payload.qa1Id ?? null,
            payload.qaFinalId ?? null,
            payload.dueAt ?? null,
          );

        const id = Number(info.lastInsertRowid);
        logActivity(db, actor.userId, 'assignments.create', `assignment:${id}`, {
          code,
          title: payload.title,
          subject: payload.subject,
          state,
        });
        return { ok: true, id, code };
      } catch (err) {
        console.error('[ipc] assignments:create failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:update',
    (
      event,
      payload: {
        id: number;
        actorId?: number | null;
        subject?: string;
        title?: string;
        publisher?: string | null;
        studentId?: number | null;
        studentCode?: string | null;
        scope?: string | null;
        lengthReq?: string | null;
        outline?: string | null;
        rubric?: string | null;
        teacherReq?: string | null;
        studentReq?: string | null;
        state?: string;
        risk?: string;
        parserId?: number | null;
        qa1Id?: number | null;
        qaFinalId?: number | null;
        dueAt?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        const db = getDb();
        const map: Array<[keyof typeof payload, string]> = [
          ['subject', 'subject'],
          ['title', 'title'],
          ['publisher', 'publisher'],
          ['studentId', 'student_id'],
          ['studentCode', 'student_code'],
          ['scope', 'scope'],
          ['lengthReq', 'length_req'],
          ['outline', 'outline'],
          ['rubric', 'rubric'],
          ['teacherReq', 'teacher_req'],
          ['studentReq', 'student_req'],
          ['state', 'state'],
          ['risk', 'risk'],
          ['parserId', 'parser_id'],
          ['qa1Id', 'qa1_id'],
          ['qaFinalId', 'qa_final_id'],
          ['dueAt', 'due_at'],
        ];
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [key, col] of map) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            sets.push(`${col} = ?`);
            params.push((payload as Record<string, unknown>)[key] ?? null);
          }
        }
        if (sets.length === 0) return { ok: false, error: 'no_fields' };
        sets.push("updated_at = datetime('now')");
        params.push(payload.id);
        const info = db
          .prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
        if (info.changes === 0) return { ok: false, error: 'not_found' };
        logActivity(db, actor.userId, 'assignments.update', `assignment:${payload.id}`, {
          keys: Object.keys(payload).filter(
            (k) => k !== 'id' && k !== 'actorId',
          ),
        });
        // state 변경 시 보관함 동기화
        if (payload.state) {
          syncAssignmentArchive(db, payload.id, payload.state, actor.userId);
        }
        return { ok: true };
      } catch (err) {
        console.error('[ipc] assignments:update failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:softDelete',
    (event, payload: { id: number; actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        const db = getDb();
        const tx = db.transaction(() => {
          const info = db
            .prepare(
              `UPDATE assignments
                  SET deleted_at = datetime('now'),
                      updated_at = datetime('now')
                WHERE id = ? AND deleted_at IS NULL`,
            )
            .run(payload.id);
          if (info.changes > 0) {
            // 승인완료 상태였다면 자동 보관함 링크도 회수
            syncAssignmentArchive(db, payload.id, '보류', actor.userId);
          }
          return info.changes;
        });
        const changes = tx();
        if (changes === 0) return { ok: false, error: 'not_found_or_already_deleted' };
        logActivity(db, actor.userId, 'assignments.softDelete', `assignment:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        console.error('[ipc] assignments:softDelete failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:restore',
    (event, payload: { id: number; actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        const db = getDb();
        const info = db
          .prepare(
            `UPDATE assignments
                SET deleted_at = NULL,
                    updated_at = datetime('now')
              WHERE id = ? AND deleted_at IS NOT NULL`,
          )
          .run(payload.id);
        if (info.changes === 0) return { ok: false, error: 'not_found_or_active' };
        logActivity(db, actor.userId, 'assignments.restore', `assignment:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        console.error('[ipc] assignments:restore failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:bulkSetState',
    (
      event,
      payload: { ids: number[]; state: string; actorId?: number | null },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
          return { ok: false, error: 'empty_ids' };
        }
        if (!ASSIGNMENT_STATES.includes(payload.state as typeof ASSIGNMENT_STATES[number])) {
          return { ok: false, error: 'invalid_state' };
        }
        const db = getDb();
        const now = new Date().toISOString();
        const completedMark = ['완료', '승인완료'].includes(payload.state);
        let changed = 0;
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            `UPDATE assignments
                SET state = ?,
                    updated_at = ?,
                    completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END
              WHERE id = ? AND deleted_at IS NULL`,
          );
          for (const id of payload.ids) {
            const res = stmt.run(payload.state, now, completedMark ? 1 : 0, now, id);
            if (res.changes > 0) {
              changed += 1;
              syncAssignmentArchive(db, id, payload.state, actor.userId);
            }
          }
        });
        tx();
        logActivity(db, actor.userId, 'assignments.bulkSetState', 'assignment:bulk', {
          ids: payload.ids,
          state: payload.state,
          changed,
        });
        return { ok: true, changed };
      } catch (err) {
        console.error('[ipc] assignments:bulkSetState failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:bulkAssign',
    (
      event,
      payload: {
        ids: number[];
        parserId?: number | null;
        qa1Id?: number | null;
        qaFinalId?: number | null;
        actorId?: number | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
          return { ok: false, error: 'empty_ids' };
        }
        const sets: string[] = [];
        const baseParams: unknown[] = [];
        if (Object.prototype.hasOwnProperty.call(payload, 'parserId')) {
          sets.push('parser_id = ?');
          baseParams.push(payload.parserId ?? null);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'qa1Id')) {
          sets.push('qa1_id = ?');
          baseParams.push(payload.qa1Id ?? null);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'qaFinalId')) {
          sets.push('qa_final_id = ?');
          baseParams.push(payload.qaFinalId ?? null);
        }
        if (sets.length === 0) return { ok: false, error: 'no_fields' };
        sets.push("updated_at = datetime('now')");
        const db = getDb();
        let changed = 0;
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            `UPDATE assignments
                SET ${sets.join(', ')}
              WHERE id = ? AND deleted_at IS NULL`,
          );
          for (const id of payload.ids) {
            const res = stmt.run(...baseParams, id);
            if (res.changes > 0) changed += 1;
          }
        });
        tx();
        logActivity(db, actor.userId, 'assignments.bulkAssign', 'assignment:bulk', {
          ids: payload.ids,
          parserId: payload.parserId,
          qa1Id: payload.qa1Id,
          qaFinalId: payload.qaFinalId,
          changed,
        });
        return { ok: true, changed };
      } catch (err) {
        console.error('[ipc] assignments:bulkAssign failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:bulkDelete',
    (event, payload: { ids: number[]; actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
          return { ok: false, error: 'empty_ids' };
        }
        const db = getDb();
        let changed = 0;
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            `UPDATE assignments
                SET deleted_at = datetime('now'),
                    updated_at = datetime('now')
              WHERE id = ? AND deleted_at IS NULL`,
          );
          for (const id of payload.ids) {
            // 휴지통 박제 — 복원 가능하도록 행 전체 JSON 보관
            recordDeletion(db, 'assignments', id, actor.userId, { reason: 'bulk delete' });
            const res = stmt.run(id);
            if (res.changes > 0) {
              changed += 1;
              syncAssignmentArchive(db, id, '보류', actor.userId);
            }
          }
        });
        tx();
        logActivity(db, actor.userId, 'assignments.bulkDelete', 'assignment:bulk', {
          ids: payload.ids,
          changed,
        });
        return { ok: true, changed };
      } catch (err) {
        console.error('[ipc] assignments:bulkDelete failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  /**
   * Transition an assignment to a new state.
   * Very thin — no role check here (UI guards for now). In Phase 2 we'll
   * move role enforcement server-side and log to `activity`.
   */
  ipcMain.handle(
    'assignments:setState',
    (event, payload: { id: number; state: string; actorId?: number; note?: string }) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      const db = getDb();
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        const res = db
          .prepare(
            `UPDATE assignments
                SET state = ?,
                    updated_at = ?,
                    completed_at = CASE WHEN ? IN ('완료','승인완료') THEN ? ELSE completed_at END
              WHERE id = ?`,
          )
          .run(payload.state, now, payload.state, now, payload.id);
        if (res.changes > 0) {
          syncAssignmentArchive(db, payload.id, payload.state, actor.userId);
        }
        return res.changes > 0;
      });
      const changed = tx();
      // 상태 전이가 실제로 이뤄진 경우만 알림 발송 — 실패/노체인지는 조용히.
      if (changed) {
        notifyAssignmentStateChange(db, payload.id, payload.state, {
          comment: payload.note ?? null,
        });
      }
      return { ok: changed };
    },
  );

  // -- parsing result ---------------------------------------------------------
  ipcMain.handle('assignments:parsingResult', (event, assignmentId: number) => {
    requireRole(event, ROLE_SETS.assignmentReader);
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, assignment_id, version, content_json, ai_summary, confidence,
                parsed_by, parsed_at
           FROM parsing_results
          WHERE assignment_id = ?
          ORDER BY version DESC
          LIMIT 1`,
      )
      .get(assignmentId);
    return row ?? null;
  });

  ipcMain.handle('assignments:reviewFiles', (event, assignmentId: number) => {
    const actor = requireRole(event, ROLE_SETS.assignmentReader);
    if (actor.role === ROLES.TA) {
      throw new AuthError('forbidden', '조교는 QA 검토 파일을 내려받을 수 없습니다.');
    }
    const db = getDb();
    const assignment = db
      .prepare(`SELECT id FROM assignments WHERE id = ? AND deleted_at IS NULL`)
      .get(assignmentId) as { id: number } | undefined;
    if (!assignment) return [];

    const rows: Array<Record<string, unknown>> = [];
    const latest = db
      .prepare(
        `SELECT id, content_json, parsed_at
           FROM parsing_results
          WHERE assignment_id = ?
          ORDER BY version DESC
          LIMIT 1`,
      )
      .get(assignmentId) as
      | { id: number; content_json: string | null; parsed_at: string | null }
      | undefined;
    if (latest?.content_json) {
      rows.push({
        id: `parser-json:${latest.id}`,
        name: `parsing-result-${latest.id}.json`,
        url: null,
        kind: 'reference',
        source: 'parser-json',
        jsonContent: latest.content_json,
        description: latest.parsed_at ?? null,
      });
      try {
        const parsed = JSON.parse(latest.content_json) as {
          sourceFile?: string;
          notionUrl?: string;
          files?: Array<{ name?: string; url?: string; kind?: string; expires?: string }>;
        };
        if (Array.isArray(parsed.files)) {
          for (const file of parsed.files) {
            if (!file?.name || !file.url) continue;
            rows.push({
              id: `notion:${latest.id}:${rows.length + 1}`,
              name: file.name,
              url: file.url,
              kind: file.kind === 'final' ? 'report' : file.kind === 'draft' ? 'draft' : 'reference',
              source: 'notion',
              description: file.expires ? `expires ${file.expires}` : null,
            });
          }
        }
        if (parsed.notionUrl) {
          rows.push({
            id: `notion-page:${latest.id}`,
            name: 'Notion 원본 페이지',
            url: parsed.notionUrl,
            kind: 'reference',
            source: 'notion',
            description: parsed.sourceFile ?? null,
          });
        } else if (parsed.sourceFile) {
          rows.push({
            id: `source:${latest.id}`,
            name: parsed.sourceFile,
            url: null,
            kind: 'reference',
            source: 'parser',
            description: '파싱 원본 파일명',
          });
        }
      } catch {
        rows.push({
          id: `source:${latest.id}`,
          name: '파싱 원본 JSON',
          url: null,
          kind: 'reference',
          source: 'parser',
          description: 'content_json 파싱 실패',
        });
      }
    }

    const archived = db
      .prepare(
        `SELECT f.id, f.category, f.original_name, f.stored_path, f.mime_type,
                f.size_bytes, f.description
           FROM student_archive_files f
           LEFT JOIN student_report_topics t ON t.id = f.topic_id
          WHERE f.source_assignment_id = ? OR t.assignment_id = ?
          ORDER BY f.uploaded_at DESC, f.id DESC`,
      )
      .all(assignmentId, assignmentId) as Array<{
      id: number;
      category: string;
      original_name: string;
      stored_path: string;
      mime_type: string | null;
      size_bytes: number | null;
      description: string | null;
    }>;
    for (const file of archived) {
      rows.push({
        id: `archive:${file.id}`,
        name: file.original_name,
        url: /^https?:\/\//i.test(file.stored_path) ? file.stored_path : null,
        kind: file.category,
        source: 'archive',
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        description: file.description,
      });
    }

    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.url ?? ''}|${row.name ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  // -- qa review history ------------------------------------------------------
  ipcMain.handle('assignments:qaReviews', (event, assignmentId: number) => {
    requireRole(event, ROLE_SETS.assignmentReader);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.id, r.stage, r.result, r.comment, r.reviewed_at,
                u.name AS reviewer_name, u.role AS reviewer_role
           FROM qa_reviews r
           LEFT JOIN users u ON u.id = r.reviewer_id
          WHERE r.assignment_id = ?
          ORDER BY r.reviewed_at DESC`,
      )
      .all(assignmentId);
    return rows;
  });


}
