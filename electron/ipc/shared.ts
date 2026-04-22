import { getDb } from '../db';

export function logActivity(
  db: ReturnType<typeof getDb>,
  actorId: number | null,
  action: string,
  target: string,
  meta: Record<string, unknown>,
) {
  try {
    db.prepare(
      `INSERT INTO activity_logs (actor_id, action, target, meta_json)
       VALUES (?, ?, ?, ?)`,
    ).run(actorId, action, target, JSON.stringify(meta));
  } catch (err) {
    console.warn('[ipc] logActivity failed', err);
  }
}

// ===========================================================================
// 휴지통 (deleted_records) 헬퍼 — v0.1.15
// ===========================================================================
// 모든 hard-DELETE / soft-delete 직전에 호출해 원본 row 를 JSON 으로 박제한다.
// 복원은 이 JSON 을 원본 테이블에 INSERT 하면 끝 (id 컬럼은 제외 또는 유지).
//
// 인자:
//   table : 원본 테이블 이름 (사용자 UI 에 그대로 노출하지 않음)
//   id    : 원본 row 의 id (복원 성공 여부 추적/activity 용)
//   actorId: 삭제를 유발한 사용자 (null 허용)
//   opts.category : UI 탭 분류
//   opts.label    : 사용자에게 보여줄 짧은 이름 (과제 코드, 업무일지 요약 등)
//   opts.reason   : 사용자가 남긴 메모
//
// 구현 디테일:
//   1) `SELECT * FROM <table> WHERE id = ?` 로 row 를 읽어 JSON 화.
//   2) row 가 이미 없으면 ("먼저 삭제됨") 조용히 리턴해 bulk 삭제의 경쟁조건을
//      죽이지 않는다.
//   3) 이 함수 자체는 DELETE 를 하지 않는다 — 호출 측이 기존대로 DELETE/UPDATE.
// ===========================================================================
const TABLE_CATEGORY: Record<string, string> = {
  assignments: 'operations',
  students: 'students',
  student_grades: 'students',
  student_counseling_logs: 'students',
  student_report_topics: 'students',
  student_archive_files: 'students',
  cs_tickets: 'cs',
  recurring_subscriptions: 'admin',
  corporate_card_transactions: 'admin',
  manual_pages: 'knowledge',
  notices: 'knowledge',
  work_logs: 'org',
  leave_requests: 'org',
  approvals: 'org',
  users: 'org',
  parsed_excel_uploads: 'parsing',
};

// 각 테이블에서 복원 시 UI 에 보여줄 라벨을 뽑는 필드 우선순위.
// 예: assignments 는 code, students 는 name, work_logs 는 summary 등.
const TABLE_LABEL_FIELDS: Record<string, string[]> = {
  assignments: ['code', 'title'],
  students: ['name', 'student_code'],
  student_grades: ['subject', 'semester'],
  student_counseling_logs: ['title', 'log_date'],
  student_report_topics: ['topic', 'subject'],
  student_archive_files: ['original_name', 'stored_name'],
  cs_tickets: ['code', 'subject'],
  recurring_subscriptions: ['vendor', 'product'],
  corporate_card_transactions: ['merchant', 'memo'],
  manual_pages: ['title', 'slug'],
  notices: ['title'],
  work_logs: ['summary', 'log_date'],
  leave_requests: ['kind', 'start_date'],
  approvals: ['code', 'title'],
  users: ['name', 'email'],
  parsed_excel_uploads: ['original_name', 'note'],
};

function pickLabel(table: string, row: Record<string, unknown>): string {
  const fields = TABLE_LABEL_FIELDS[table] ?? [];
  for (const f of fields) {
    const v = row[f];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  // fallback — 아무 텍스트 값이든
  for (const [, v] of Object.entries(row)) {
    if (typeof v === 'string' && v.trim() && v.length < 120) return v;
  }
  return `#${row.id ?? '?'}`;
}

// ---------------------------------------------------------------------------
// Notification producers (v0.1.16 알림 센터)
// ---------------------------------------------------------------------------
// 운영 이벤트(결재 요청 / 과제 반려 / QA 요청 / CS 지연 / 학원비 미납 / 휴지통
// 복원 결과 등) 를 notifications 테이블에 멱등 삽입한다. `dedupe_key` 에
// 자연 키를 넣으면 "같은 사용자 + 같은 키 + 아직 dismissed 안 됨" 은 DB partial
// unique 인덱스로 중복 생성이 차단된다.
//
// 생산자는 **본 업무 트랜잭션 실패가 알림 실패로 번지지 않도록** 바깥에서
// 호출한다 (DB 트랜잭션 안에 넣지 않음). 알림 삽입이 실패해도 로그만 남긴다.

export type NotificationCategory =
  | 'approval'
  | 'assignment'
  | 'qa'
  | 'cs'
  | 'tuition'
  | 'trash'
  | 'notice'
  | 'system';

interface RecordNotificationInput {
  userId: number;
  category: NotificationCategory;
  kind: string; // 레거시 호환용 자유 문자열 (예: 'approval.requested')
  title: string;
  body?: string | null;
  link?: string | null;
  entityTable?: string | null;
  entityId?: number | null;
  dedupeKey?: string | null;
  priority?: number; // -1 low, 0 normal, 1 high
  payload?: Record<string, unknown> | null;
}

export function recordNotification(
  db: ReturnType<typeof getDb>,
  input: RecordNotificationInput,
): number | null {
  try {
    // INSERT OR IGNORE 는 UNIQUE 인덱스 충돌을 조용히 무시한다. dedup 이 걸린
    // 알림은 "같은 유저가 이미 동일 이벤트로 미처리 알림을 가지고 있다" 는
    // 뜻이므로 그대로 버리면 된다.
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO notifications
         (user_id, category, kind, title, body, link,
          entity_table, entity_id, dedupe_key, priority, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(
      input.userId,
      input.category,
      input.kind,
      input.title,
      input.body ?? null,
      input.link ?? null,
      input.entityTable ?? null,
      input.entityId ?? null,
      input.dedupeKey ?? null,
      input.priority ?? 0,
      input.payload ? JSON.stringify(input.payload) : null,
    );
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  } catch (err) {
    console.warn(
      `[ipc] recordNotification(user=${input.userId}, kind=${input.kind}) failed:`,
      err,
    );
    return null;
  }
}

/** 여러 명에게 한 번에. 개별 실패는 묵살. */
export function recordNotificationToMany(
  db: ReturnType<typeof getDb>,
  userIds: Iterable<number>,
  input: Omit<RecordNotificationInput, 'userId'>,
) {
  for (const uid of userIds) {
    if (!uid || uid <= 0) continue;
    recordNotification(db, { ...input, userId: uid });
  }
}

/** 해당 엔티티에 붙은 모든 미처리 알림을 dismiss — 이벤트가 해결됐을 때 호출. */
export function dismissEntityNotifications(
  db: ReturnType<typeof getDb>,
  entityTable: string,
  entityId: number,
) {
  try {
    db.prepare(
      `UPDATE notifications
          SET dismissed_at = datetime('now')
        WHERE entity_table = ? AND entity_id = ? AND dismissed_at IS NULL`,
    ).run(entityTable, entityId);
  } catch (err) {
    console.warn('[ipc] dismissEntityNotifications failed:', err);
  }
}

/**
 * Assignment state 변경 시 알림 대상 결정 + 발송.
 * 새 state 에 따라 parser/qa1/qa_final 중 누구에게 알려야 하는지 고정 규칙.
 *   - 1차QA대기        → qa1_id
 *   - 최종QA대기       → qa_final_id
 *   - 1차QA반려/수정요청 → parser_id
 *   - 최종QA반려       → parser_id + qa1_id
 *   - 승인완료         → parser_id (긍정 통지)
 *   - 자료누락         → parser_id (블로커)
 *   - 보류             → parser_id (저우선순위)
 * 알림 발송 전, 해당 과제에 붙은 이전 단계의 미처리 알림들은 모두 dismiss 한다.
 */
export function notifyAssignmentStateChange(
  db: ReturnType<typeof getDb>,
  assignmentId: number,
  newState: string,
  opts?: { comment?: string | null; stage?: string | null },
): void {
  try {
    // 이전 단계에서 남은 미처리 알림은 걷어낸다 — 상태가 바뀌었으므로 더 이상 유효하지 않음.
    dismissEntityNotifications(db, 'assignments', assignmentId);

    const asn = db
      .prepare(
        `SELECT code, title, parser_id, qa1_id, qa_final_id
           FROM assignments WHERE id = ?`,
      )
      .get(assignmentId) as
      | {
          code: string;
          title: string;
          parser_id: number | null;
          qa1_id: number | null;
          qa_final_id: number | null;
        }
      | undefined;
    if (!asn) return;

    const baseLink = `/operations?focus=${assignmentId}`;
    const comment = opts?.comment?.trim();
    const commentBody = comment ? ` · ${comment}` : '';
    const defaultBody = `[${asn.code}] ${asn.title}${commentBody}`;

    const send = (
      userId: number | null,
      kind: string,
      title: string,
      priority = 0,
      body?: string,
    ) => {
      if (!userId) return;
      recordNotification(db, {
        userId,
        category: 'assignment',
        kind,
        title,
        body: body ?? defaultBody,
        link: baseLink,
        entityTable: 'assignments',
        entityId: assignmentId,
        dedupeKey: `assignment:${assignmentId}:${kind}`,
        priority,
      });
    };

    switch (newState) {
      case '1차QA대기':
        send(asn.qa1_id, 'assignment.qa1_ready', `1차 QA 요청: ${asn.title}`, 1);
        break;
      case '최종QA대기':
        send(asn.qa_final_id, 'assignment.final_ready', `최종 QA 요청: ${asn.title}`, 1);
        break;
      case '1차QA반려':
        send(asn.parser_id, 'assignment.qa1_rejected', `1차 QA 반려: ${asn.title}`, 1);
        break;
      case '최종QA반려':
        send(asn.parser_id, 'assignment.final_rejected', `최종 QA 반려: ${asn.title}`, 1);
        send(
          asn.qa1_id,
          'assignment.final_rejected_qa1',
          `최종 QA 반려 (1차 검토분): ${asn.title}`,
          0,
        );
        break;
      case '수정요청':
        send(
          asn.parser_id,
          'assignment.revision_requested',
          `수정 요청: ${asn.title}`,
          1,
        );
        break;
      case '자료누락':
        send(asn.parser_id, 'assignment.data_missing', `자료 누락: ${asn.title}`, 1);
        break;
      case '승인완료':
        send(asn.parser_id, 'assignment.approved', `승인 완료: ${asn.title}`, 0);
        break;
      case '보류':
        send(asn.parser_id, 'assignment.held', `보류됨: ${asn.title}`, -1);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn('[ipc] notifyAssignmentStateChange failed:', err);
  }
}

export function recordDeletion(
  db: ReturnType<typeof getDb>,
  table: string,
  id: number,
  actorId: number | null,
  opts?: { reason?: string | null; label?: string | null; category?: string | null },
): boolean {
  try {
    // PRAGMA 로 컬럼 검증은 생략 — table 명은 코드 상수이므로 SQL 인젝션 위험 없음.
    const row = db
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return false; // 이미 없는 행 — 조용히 넘어간다.

    const category = opts?.category ?? TABLE_CATEGORY[table] ?? 'other';
    const label = opts?.label ?? pickLabel(table, row);

    db.prepare(
      `INSERT INTO deleted_records
         (table_name, row_id, category, label, payload_json, reason, deleted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      table,
      id,
      category,
      label,
      JSON.stringify(row),
      opts?.reason ?? null,
      actorId,
    );
    return true;
  } catch (err) {
    // tombstone 실패가 본 DELETE 를 막게 하진 않는다 — 로그만 남긴다.
    console.warn(`[ipc] recordDeletion(${table}#${id}) failed:`, err);
    return false;
  }
}

/**
 * Sync the student archive with an assignment's current state.
 *
 * - `승인완료` (final approval) → ensure one auto-generated archive row exists
 *   for this assignment. Re-approvals are idempotent (no duplicate rows).
 * - Any other state → remove any auto-generated archive rows for this
 *   assignment. This covers the rejection flow: an assignment that was
 *   briefly 승인완료 then flipped back (e.g. 최종QA반려, 수정요청) gets pulled
 *   out of the archive automatically.
 *
 * Manually uploaded rows (`auto_generated = 0`) are never touched — if a
 * teacher hand-archived a file, we don't revoke it.
 *
 * Safe to call inside the caller's transaction — every statement here is
 * narrow and idempotent.
 */
export function syncAssignmentArchive(
  db: ReturnType<typeof getDb>,
  assignmentId: number,
  newState: string,
  actorId: number | null,
) {
  try {
    interface AssignmentRow {
      id: number;
      code: string;
      title: string;
      subject: string | null;
      publisher: string | null;
      student_id: number | null;
    }
    const row = db
      .prepare(
        `SELECT id, code, title, subject, publisher, student_id
           FROM assignments
          WHERE id = ?`,
      )
      .get(assignmentId) as AssignmentRow | undefined;
    if (!row) return;

    if (newState === '승인완료') {
      // No student linkage → can't archive to a specific student.
      if (!row.student_id) return;

      const existing = db
        .prepare(
          `SELECT id FROM student_archive_files
            WHERE source_assignment_id = ? AND auto_generated = 1
            LIMIT 1`,
        )
        .get(assignmentId) as { id: number } | undefined;
      if (existing) return; // already archived

      const descParts: string[] = [];
      if (row.subject) descParts.push(row.subject);
      if (row.publisher) descParts.push(row.publisher);
      descParts.push(`과제코드 ${row.code}`);
      const description = `[자동] 최종 승인된 과제 · ${descParts.join(' · ')}`;
      const originalName = `${row.code} ${row.title}`.slice(0, 240);

      const info = db
        .prepare(
          `INSERT INTO student_archive_files (
              student_id, topic_id, category, original_name, stored_path,
              mime_type, size_bytes, description,
              source_assignment_id, auto_generated,
              uploaded_by
           ) VALUES (?, NULL, 'report', ?, ?, NULL, NULL, ?, ?, 1, ?)`,
        )
        .run(
          row.student_id,
          originalName,
          `assignment://${row.id}`,
          description,
          assignmentId,
          actorId,
        );

      logActivity(db, actorId, 'students.autoArchive', `archiveFile:${info.lastInsertRowid}`, {
        assignmentId,
        studentId: row.student_id,
        code: row.code,
      });
    } else {
      // Rolling back an earlier final approval — yank any auto-archived rows.
      const removedRows = db
        .prepare(
          `SELECT id FROM student_archive_files
            WHERE source_assignment_id = ? AND auto_generated = 1`,
        )
        .all(assignmentId) as Array<{ id: number }>;
      if (removedRows.length === 0) return;

      const res = db
        .prepare(
          `DELETE FROM student_archive_files
            WHERE source_assignment_id = ? AND auto_generated = 1`,
        )
        .run(assignmentId);

      if (res.changes > 0) {
        logActivity(db, actorId, 'students.autoUnarchive', `assignment:${assignmentId}`, {
          assignmentId,
          newState,
          removed: removedRows.map((r) => r.id),
        });
      }
    }
  } catch (err) {
    console.warn('[ipc] syncAssignmentArchive failed', err);
  }
}
