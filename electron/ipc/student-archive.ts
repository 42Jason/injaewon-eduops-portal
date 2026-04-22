import { ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { getDb } from '../db';
import { normalizeRole, requireActor, requireRole, ROLES, ROLE_SETS, type SessionActor } from '../auth';
import { NotionSync, type NotionSettings } from '../notion-sync';

type StudentArchiveIpcDeps = {
  logActivity: (
    db: ReturnType<typeof getDb>,
    actorId: number | null,
    action: string,
    target: string,
    meta: Record<string, unknown>,
  ) => void;
  recordDeletion: (
    db: ReturnType<typeof getDb>,
    table: string,
    id: number,
    actorId: number | null,
    opts?: { reason?: string | null; label?: string | null; category?: string | null },
  ) => boolean;
};

const EXCLUDED_NOTION_STUDENT_CODES = [
  'N-컨설-0205106D',
  'N-컨설-0456381C',
  'N-컨설-1D38BA09',
  'N-컨설-4D232616',
  'N-컨설-6193F5E9',
  'N-컨설-65C6D943',
  'N-컨설-864AC0C9',
  'N-컨설-9D7F99D3',
  'N-컨설-A4E1ED71',
  'N-컨설-A881426C',
  'N-컨설-C3DF61BD',
  'N-컨설-EEDEE887',
  'N-컨설-FF2A863E',
] as const;

const EXCLUDED_NOTION_STUDENT_CODE_SET = new Set<string>(EXCLUDED_NOTION_STUDENT_CODES);

function canViewStudentIdentity(actor: SessionActor): boolean {
  const role = normalizeRole(actor.role);
  return role !== ROLES.TA;
}

function maskStudentName(name: unknown): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) return '-';
  return `${raw.slice(0, 1)}**`;
}

function redactStudentRow<T extends Record<string, unknown>>(row: T, reveal: boolean): T {
  if (reveal) return row;
  return {
    ...row,
    name: maskStudentName(row.name),
    phone: null,
    guardian: null,
    guardian_phone: null,
    identity_label: null,
    memo: null,
    grade_memo: null,
  };
}

function readNotionExtra(row: Record<string, unknown>): Record<string, unknown> {
  if (typeof row.notion_extra !== 'string' || !row.notion_extra.trim()) return {};
  try {
    const parsed = JSON.parse(row.notion_extra) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readNotionProperty(row: Record<string, unknown>, names: string[]): string {
  const extra = readNotionExtra(row);
  const props = extra.properties;
  if (!props || typeof props !== 'object') return '';
  const record = props as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizeStudentIdentityPart(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim().toLowerCase() : '';
}

function studentIdentitySeed(row: Record<string, unknown>): string {
  const realName = readNotionProperty(row, [
    'ㅤ',
    '실명',
    '학생명',
    '학생 이름',
    '학생이름',
    '성명',
  ]);
  const name = normalizeStudentIdentityPart(realName || row.name);
  const contact = normalizeStudentIdentityPart(row.guardian_phone || row.phone);
  const school = normalizeStudentIdentityPart(row.school);
  if (name && contact) return `name:${name}|contact:${contact}`;
  if (name && school) return `name:${name}|school:${school}`;
  if (name) return `name:${name}`;
  return `id:${row.id ?? ''}`;
}

function attachStudentIdentityKey<T extends Record<string, unknown>>(row: T): T & { identity_key: string } {
  const seed = studentIdentitySeed(row);
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 24);
  const identityLabel = readNotionProperty(row, [
    '고유번호',
    '학생고유번호',
    '학생 고유번호',
    '학생번호',
    '학생 번호',
  ]);
  return {
    ...row,
    identity_key: `student:${digest}`,
    identity_label: identityLabel || null,
    name_masked: typeof row.name === 'string' && row.name.includes('*') ? 1 : 0,
  };
}

function stripPrivateListFields<T extends Record<string, unknown>>(row: T): T {
  const { notion_extra: _notionExtra, ...publicRow } = row;
  return publicRow as T;
}

// ===========================================================================
// Student information archive (학생 정보 보관함)
//  - list / get students + full activity history (assignments + parsing_results)
//  - report topics CRUD
//  - archive files CRUD (metadata only — file bytes live elsewhere for now)
// ===========================================================================
export function registerStudentArchiveIpc({ logActivity, recordDeletion }: StudentArchiveIpcDeps) {
  // ---- students listing --------------------------------------------------
  ipcMain.handle(
    'students:list',
    (event, filter?: { q?: string; limit?: number; includeDeleted?: boolean }) => {
      const actor = requireActor(event);
      const revealIdentity = canViewStudentIdentity(actor);
      const db = getDb();
      const where: string[] = [];
      if (!filter?.includeDeleted) where.push('s.deleted_at IS NULL');
      where.push(
        `(s.notion_page_id IS NULL
          OR EXISTS (SELECT 1 FROM assignments a WHERE a.student_id = s.id AND a.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM student_report_topics t WHERE t.student_id = s.id)
          OR EXISTS (SELECT 1 FROM student_archive_files f WHERE f.student_id = s.id)
          OR EXISTS (SELECT 1 FROM student_grades g WHERE g.student_id = s.id)
          OR EXISTS (SELECT 1 FROM student_counseling_logs c WHERE c.student_id = s.id))`,
      );
      const params: unknown[] = [];
      where.push(
        `s.student_code NOT IN (${EXCLUDED_NOTION_STUDENT_CODES.map(() => '?').join(', ')})`,
      );
      params.push(...EXCLUDED_NOTION_STUDENT_CODES);
      if (filter?.q && filter.q.trim()) {
        where.push(
          '(s.name LIKE ? OR s.student_code LIKE ? OR s.school LIKE ? OR s.school_no LIKE ? OR s.guardian LIKE ? OR s.phone LIKE ? OR s.guardian_phone LIKE ?)',
        );
        const like = `%${filter.q.trim()}%`;
        params.push(like, like, like, like, like, like, like);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const lim = Math.min(Math.max(filter?.limit ?? 500, 1), 2000);
      const rows = db
        .prepare(
          `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.school_no,
                  s.phone, s.guardian, s.guardian_phone, s.grade_memo, s.memo,
                  s.notion_page_id, s.notion_source, s.notion_synced_at, s.notion_extra,
                  s.created_at, s.deleted_at,
                  (SELECT COUNT(*) FROM assignments a WHERE a.student_id = s.id AND a.deleted_at IS NULL) AS assignment_count,
                  (SELECT COUNT(*) FROM student_report_topics t WHERE t.student_id = s.id) AS topic_count,
                  (SELECT COUNT(*) FROM student_archive_files f WHERE f.student_id = s.id) AS file_count,
                  (SELECT COUNT(*) FROM student_grades g WHERE g.student_id = s.id) AS grade_count,
                  (SELECT COUNT(*) FROM student_counseling_logs c WHERE c.student_id = s.id) AS counseling_count
             FROM students s
            ${whereSql}
            ORDER BY s.name ASC, s.student_code ASC
            LIMIT ${lim}`,
        )
        .all(...params);
      return (rows as Array<Record<string, unknown>>).map((row) =>
        stripPrivateListFields(redactStudentRow(attachStudentIdentityKey(row), revealIdentity)),
      );
    },
  );

  ipcMain.handle('students:get', (event, studentId: number) => {
    const actor = requireRole(event, ROLE_SETS.studentDataReader);
    const revealIdentity = canViewStudentIdentity(actor);
    const db = getDb();
    const row = db
      .prepare(
        `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.school_no,
                s.phone, s.guardian, s.guardian_phone, s.grade_memo, s.memo,
                s.monthly_fee, s.billing_day, s.billing_active,
                s.notion_page_id, s.notion_source, s.notion_synced_at,
                s.created_at, s.deleted_at
           FROM students s
          WHERE s.id = ?`,
      )
      .get(studentId);
    if (!row) return null;
    const studentCode = (row as { student_code?: string }).student_code;
    if (studentCode && EXCLUDED_NOTION_STUDENT_CODE_SET.has(studentCode)) return null;
    return redactStudentRow(row as Record<string, unknown>, revealIdentity);
  });

  // ---- students CRUD -----------------------------------------------------
  // 수동 학생 추가. student_code 는 비워오면 'M-<타임스탬프>' 자동 발급.
  ipcMain.handle(
    'students:create',
    (
      event,
      payload: {
        studentCode?: string | null;
        name: string;
        grade?: string | null;
        school?: string | null;
        schoolNo?: string | null;
        phone?: string | null;
        guardian?: string | null;
        guardianPhone?: string | null;
        gradeMemo?: string | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        const name = payload.name?.trim();
        if (!name) return { ok: false, error: 'name_required' };
        let code = payload.studentCode?.trim();
        if (!code) {
          // 'M-<yyMMddHHmm>-<rand>' 형태로 충돌 최소화
          const d = new Date();
          const pad = (n: number) => n.toString().padStart(2, '0');
          const stamp = `${d.getFullYear().toString().slice(-2)}${pad(d.getMonth() + 1)}${pad(
            d.getDate(),
          )}${pad(d.getHours())}${pad(d.getMinutes())}`;
          code = `M-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        }
        // UNIQUE 충돌 시 재발급
        const existing = db
          .prepare(`SELECT id FROM students WHERE student_code = ?`)
          .get(code);
        if (existing) {
          return { ok: false, error: 'code_conflict', message: `학생 코드 "${code}" 가 이미 존재합니다.` };
        }
        const info = db
          .prepare(
            `INSERT INTO students (
               student_code, name, grade, school, school_no,
               phone, guardian, guardian_phone, grade_memo, memo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            code,
            name,
            payload.grade ?? null,
            payload.school ?? null,
            payload.schoolNo ?? null,
            payload.phone ?? null,
            payload.guardian ?? null,
            payload.guardianPhone ?? null,
            payload.gradeMemo ?? null,
            payload.memo ?? null,
          );
        logActivity(db, actor.userId, 'students.create', `student:${info.lastInsertRowid}`, {
          studentCode: code,
          name,
        });
        return { ok: true, id: Number(info.lastInsertRowid), studentCode: code };
      } catch (err) {
        console.error('[ipc] students:create error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:update',
    (
      event,
      payload: {
        id: number;
        name?: string;
        grade?: string | null;
        school?: string | null;
        schoolNo?: string | null;
        phone?: string | null;
        guardian?: string | null;
        guardianPhone?: string | null;
        gradeMemo?: string | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        const fields: string[] = [];
        const params: unknown[] = [];
        const map: Array<[keyof typeof payload, string]> = [
          ['name', 'name'],
          ['grade', 'grade'],
          ['school', 'school'],
          ['schoolNo', 'school_no'],
          ['phone', 'phone'],
          ['guardian', 'guardian'],
          ['guardianPhone', 'guardian_phone'],
          ['gradeMemo', 'grade_memo'],
          ['memo', 'memo'],
        ];
        for (const [key, col] of map) {
          const v = payload[key];
          if (v !== undefined) {
            fields.push(`${col} = ?`);
            params.push(v);
          }
        }
        if (fields.length === 0) return { ok: false, error: 'no_fields' };
        params.push(payload.id);
        const res = db
          .prepare(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`)
          .run(...params);
        logActivity(db, actor.userId, 'students.update', `student:${payload.id}`, {
          changed: fields.length,
        });
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] students:update error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:softDelete',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      // 학생 삭제는 운영관리자·임원만 가능.
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        // students 는 이미 deleted_at 로 soft-delete 되지만, 휴지통 UI 통합을
        // 위해 tombstone 도 같이 기록한다. 복원 시 두 경로 모두 처리.
        recordDeletion(db, 'students', payload.id, actor.userId, { reason: payload.reason });
        const res = db
          .prepare(
            `UPDATE students SET deleted_at = datetime('now')
              WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(payload.id);
        logActivity(db, actor.userId, 'students.softDelete', `student:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] students:softDelete error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:restore',
    (event, payload: { id: number; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        const res = db
          .prepare(`UPDATE students SET deleted_at = NULL WHERE id = ?`)
          .run(payload.id);
        logActivity(db, actor.userId, 'students.restore', `student:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] students:restore error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  // ---- student grades (내신) --------------------------------------------
  ipcMain.handle('students:listGrades', (event, studentId: number) => {
    requireRole(event, ROLE_SETS.studentDataReader);
    const db = getDb();
    return db
      .prepare(
        `SELECT g.id, g.student_id, g.grade_level, g.semester, g.subject,
                g.score, g.raw_score, g.memo,
                g.created_by, g.created_at, g.updated_at,
                u.name AS created_by_name
           FROM student_grades g
           LEFT JOIN users u ON u.id = g.created_by
          WHERE g.student_id = ?
          ORDER BY g.grade_level DESC, g.semester DESC, g.subject ASC`,
      )
      .all(studentId);
  });

  ipcMain.handle(
    'students:upsertGrade',
    (
      event,
      payload: {
        id?: number;
        studentId: number;
        gradeLevel: string;
        semester: string;
        subject: string;
        score?: string | null;
        rawScore?: number | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        if (!payload.gradeLevel?.trim() || !payload.semester?.trim() || !payload.subject?.trim()) {
          return { ok: false, error: 'missing_key' };
        }
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE student_grades
                  SET grade_level = ?, semester = ?, subject = ?,
                      score = ?, raw_score = ?, memo = ?,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .run(
              payload.gradeLevel.trim(),
              payload.semester.trim(),
              payload.subject.trim(),
              payload.score ?? null,
              payload.rawScore ?? null,
              payload.memo ?? null,
              payload.id,
            );
          logActivity(db, actor.userId, 'students.updateGrade', `grade:${payload.id}`, {
            studentId: payload.studentId,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        // insert with ON CONFLICT → treat as update on UNIQUE violation
        try {
          const info = db
            .prepare(
              `INSERT INTO student_grades (
                 student_id, grade_level, semester, subject,
                 score, raw_score, memo, created_by
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              payload.studentId,
              payload.gradeLevel.trim(),
              payload.semester.trim(),
              payload.subject.trim(),
              payload.score ?? null,
              payload.rawScore ?? null,
              payload.memo ?? null,
              actor.userId,
            );
          logActivity(db, actor.userId, 'students.addGrade', `grade:${info.lastInsertRowid}`, {
            studentId: payload.studentId,
          });
          return { ok: true, id: Number(info.lastInsertRowid) };
        } catch (err: unknown) {
          const msg = (err as Error).message ?? '';
          if (msg.includes('UNIQUE')) {
            // fallback: update existing row
            const res = db
              .prepare(
                `UPDATE student_grades
                    SET score = ?, raw_score = ?, memo = ?,
                        updated_at = datetime('now')
                  WHERE student_id = ? AND grade_level = ?
                    AND semester = ? AND subject = ?`,
              )
              .run(
                payload.score ?? null,
                payload.rawScore ?? null,
                payload.memo ?? null,
                payload.studentId,
                payload.gradeLevel.trim(),
                payload.semester.trim(),
                payload.subject.trim(),
              );
            return { ok: res.changes > 0, merged: true };
          }
          throw err;
        }
      } catch (err) {
        console.error('[ipc] students:upsertGrade error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteGrade',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      recordDeletion(db, 'student_grades', payload.id, actor.userId, { reason: payload.reason });
      const res = db.prepare(`DELETE FROM student_grades WHERE id = ?`).run(payload.id);
      logActivity(db, actor.userId, 'students.deleteGrade', `grade:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ---- student counseling logs (상담 이력) ------------------------------
  ipcMain.handle('students:listCounseling', (event, studentId: number) => {
    requireRole(event, ROLE_SETS.studentDataReader);
    const db = getDb();
    return db
      .prepare(
        `SELECT c.id, c.student_id, c.log_date, c.title, c.body, c.category,
                c.created_by, c.created_at, c.updated_at,
                u.name AS created_by_name
           FROM student_counseling_logs c
           LEFT JOIN users u ON u.id = c.created_by
          WHERE c.student_id = ?
          ORDER BY c.log_date DESC, c.id DESC
          LIMIT 500`,
      )
      .all(studentId);
  });

  ipcMain.handle(
    'students:upsertCounseling',
    (
      event,
      payload: {
        id?: number;
        studentId: number;
        logDate: string;
        title: string;
        body?: string | null;
        category?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        const title = payload.title?.trim();
        const logDate = payload.logDate?.trim();
        if (!title) return { ok: false, error: 'title_required' };
        if (!logDate) return { ok: false, error: 'log_date_required' };
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE student_counseling_logs
                  SET log_date = ?, title = ?, body = ?, category = ?,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .run(logDate, title, payload.body ?? null, payload.category ?? null, payload.id);
          logActivity(db, actor.userId, 'students.updateCounseling', `counseling:${payload.id}`, {
            studentId: payload.studentId,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        const info = db
          .prepare(
            `INSERT INTO student_counseling_logs (
               student_id, log_date, title, body, category, created_by
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.studentId,
            logDate,
            title,
            payload.body ?? null,
            payload.category ?? null,
            actor.userId,
          );
        logActivity(db, actor.userId, 'students.addCounseling', `counseling:${info.lastInsertRowid}`, {
          studentId: payload.studentId,
        });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        console.error('[ipc] students:upsertCounseling error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteCounseling',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      recordDeletion(db, 'student_counseling_logs', payload.id, actor.userId, {
        reason: payload.reason,
      });
      const res = db
        .prepare(`DELETE FROM student_counseling_logs WHERE id = ?`)
        .run(payload.id);
      logActivity(db, actor.userId, 'students.deleteCounseling', `counseling:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ---- combined history: assignments + parsing_results ------------------
  ipcMain.handle('students:history', (event, studentId: number) => {
    requireRole(event, ROLE_SETS.studentDataReader);
    const db = getDb();
    const assignments = db
      .prepare(
        `SELECT a.id, a.code, a.title, a.subject, a.publisher, a.scope, a.length_req,
                a.state, a.risk, a.due_at, a.received_at, a.completed_at,
                a.parser_id, a.qa1_id, a.qa_final_id,
                up.name AS parser_name,
                u1.name AS qa1_name,
                u2.name AS qa_final_name,
                (SELECT COUNT(*) FROM parsing_results p WHERE p.assignment_id = a.id) AS parsing_count
           FROM assignments a
           LEFT JOIN users up ON up.id = a.parser_id
           LEFT JOIN users u1 ON u1.id = a.qa1_id
           LEFT JOIN users u2 ON u2.id = a.qa_final_id
          WHERE a.student_id = ?
          ORDER BY COALESCE(a.received_at, a.created_at) DESC
          LIMIT 300`,
      )
      .all(studentId);

    const parsings = db
      .prepare(
        `SELECT p.id, p.assignment_id, p.version, p.ai_summary, p.confidence,
                p.parsed_at, p.parsed_by,
                u.name AS parser_name,
                a.code AS assignment_code,
                a.title AS assignment_title,
                a.subject AS assignment_subject
           FROM parsing_results p
           JOIN assignments a ON a.id = p.assignment_id
           LEFT JOIN users u ON u.id = p.parsed_by
          WHERE a.student_id = ?
          ORDER BY p.parsed_at DESC
          LIMIT 300`,
      )
      .all(studentId);

    return { assignments, parsings };
  });

  // ---- parsing result detail (for modal view) ----------------------------
  ipcMain.handle('students:getParsingDetail', (event, parsingId: number) => {
    requireRole(event, ROLE_SETS.studentDataReader);
    const db = getDb();
    const row = db
      .prepare(
        `SELECT p.id, p.assignment_id, p.version, p.content_json, p.ai_summary,
                p.confidence, p.parsed_at, p.parsed_by,
                u.name AS parser_name,
                a.student_id,
                a.student_code,
                a.code AS assignment_code,
                a.title AS assignment_title,
                a.subject AS assignment_subject,
                a.publisher AS assignment_publisher,
                a.scope AS assignment_scope,
                a.length_req AS assignment_length_req,
                a.due_at AS assignment_due_at
           FROM parsing_results p
           JOIN assignments a ON a.id = p.assignment_id
           LEFT JOIN users u ON u.id = p.parsed_by
          WHERE p.id = ?`,
      )
      .get(parsingId);
    return row ?? null;
  });

  // ---- report topics -----------------------------------------------------
  ipcMain.handle('students:listReportTopics', (event, studentId: number) => {
    requireRole(event, ROLE_SETS.studentDataReader);
    const db = getDb();
    return db
      .prepare(
        `SELECT t.id, t.student_id, t.title, t.subject, t.topic, t.status,
                t.assignment_id, t.due_at, t.submitted_at, t.score, t.memo,
                t.created_by, t.created_at, t.updated_at,
                a.code AS assignment_code,
                u.name AS created_by_name,
                (SELECT COUNT(*) FROM student_archive_files f WHERE f.topic_id = t.id) AS file_count
           FROM student_report_topics t
           LEFT JOIN assignments a ON a.id = t.assignment_id
           LEFT JOIN users u ON u.id = t.created_by
          WHERE t.student_id = ?
          ORDER BY COALESCE(t.due_at, t.created_at) DESC, t.id DESC
          LIMIT 500`,
      )
      .all(studentId);
  });

  ipcMain.handle(
    'students:upsertReportTopic',
    (
      event,
      payload: {
        id?: number;
        studentId: number;
        title: string;
        subject?: string;
        topic?: string;
        status?: string;
        assignmentId?: number | null;
        dueAt?: string | null;
        submittedAt?: string | null;
        score?: string | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        const title = payload.title?.trim();
        if (!title) return { ok: false, error: 'title_required' };
        const status = payload.status ?? 'planned';
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE student_report_topics
                  SET title = ?, subject = ?, topic = ?, status = ?,
                      assignment_id = ?, due_at = ?, submitted_at = ?,
                      score = ?, memo = ?,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .run(
              title,
              payload.subject ?? null,
              payload.topic ?? null,
              status,
              payload.assignmentId ?? null,
              payload.dueAt ?? null,
              payload.submittedAt ?? null,
              payload.score ?? null,
              payload.memo ?? null,
              payload.id,
            );
          logActivity(db, actor.userId, 'students.updateReportTopic', `topic:${payload.id}`, {
            studentId: payload.studentId,
            title,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        const info = db
          .prepare(
            `INSERT INTO student_report_topics (
                student_id, title, subject, topic, status,
                assignment_id, due_at, submitted_at, score, memo, created_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.studentId,
            title,
            payload.subject ?? null,
            payload.topic ?? null,
            status,
            payload.assignmentId ?? null,
            payload.dueAt ?? null,
            payload.submittedAt ?? null,
            payload.score ?? null,
            payload.memo ?? null,
            actor.userId,
          );
        logActivity(
          db,
          actor.userId,
          'students.createReportTopic',
          `topic:${info.lastInsertRowid}`,
          { studentId: payload.studentId, title },
        );
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteReportTopic',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        recordDeletion(db, 'student_report_topics', payload.id, actor.userId, {
          reason: payload.reason,
        });
        const res = db
          .prepare(`DELETE FROM student_report_topics WHERE id = ?`)
          .run(payload.id);
        logActivity(db, actor.userId, 'students.deleteReportTopic', `topic:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  // ---- archive files -----------------------------------------------------
  ipcMain.handle(
    'students:listArchiveFiles',
    (event, filter: { studentId: number; topicId?: number | null }) => {
      requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      const where: string[] = ['f.student_id = ?'];
      const params: unknown[] = [filter.studentId];
      if (typeof filter.topicId === 'number') {
        where.push('f.topic_id = ?');
        params.push(filter.topicId);
      }
      return db
        .prepare(
          `SELECT f.id, f.student_id, f.topic_id, f.category,
                  f.original_name, f.stored_path, f.mime_type, f.size_bytes,
                  f.description, f.uploaded_at, f.uploaded_by,
                  f.source_assignment_id, f.auto_generated,
                  u.name AS uploader_name,
                  t.title AS topic_title,
                  a.code AS source_assignment_code,
                  a.title AS source_assignment_title,
                  a.state AS source_assignment_state
             FROM student_archive_files f
             LEFT JOIN users u ON u.id = f.uploaded_by
             LEFT JOIN student_report_topics t ON t.id = f.topic_id
             LEFT JOIN assignments a ON a.id = f.source_assignment_id
            WHERE ${where.join(' AND ')}
            ORDER BY f.uploaded_at DESC
            LIMIT 500`,
        )
        .all(...params);
    },
  );

  ipcMain.handle(
    'students:addArchiveFile',
    (
      event,
      payload: {
        studentId: number;
        topicId?: number | null;
        category?: string;
        originalName: string;
        storedPath?: string;
        mimeType?: string;
        sizeBytes?: number;
        description?: string | null;
        uploaderId: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        const name = payload.originalName?.trim();
        if (!name) return { ok: false, error: 'name_required' };
        const category = payload.category ?? 'report';
        const storedPath = payload.storedPath ?? `local://${name}`;
        const info = db
          .prepare(
            `INSERT INTO student_archive_files (
                student_id, topic_id, category, original_name, stored_path,
                mime_type, size_bytes, description,
                source_assignment_id, auto_generated,
                uploaded_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
          )
          .run(
            payload.studentId,
            payload.topicId ?? null,
            category,
            name,
            storedPath,
            payload.mimeType ?? null,
            payload.sizeBytes ?? null,
            payload.description ?? null,
            actor.userId,
          );
        logActivity(
          db,
          actor.userId,
          'students.addArchiveFile',
          `archiveFile:${info.lastInsertRowid}`,
          { studentId: payload.studentId, name, category },
        );
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'add_failed' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteArchiveFile',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.studentDataReader);
      const db = getDb();
      try {
        // Auto-generated rows are managed by syncAssignmentArchive — don't let
        // manual deletes orphan them. If the user truly wants to remove such a
        // row, they should revert the underlying assignment state instead.
        const existing = db
          .prepare(
            `SELECT auto_generated FROM student_archive_files WHERE id = ?`,
          )
          .get(payload.id) as { auto_generated: number } | undefined;
        if (!existing) return { ok: false, error: 'not_found' };
        if (existing.auto_generated) {
          return { ok: false, error: 'auto_generated_readonly' };
        }
        recordDeletion(db, 'student_archive_files', payload.id, actor.userId, {
          reason: payload.reason,
        });
        const res = db
          .prepare(`DELETE FROM student_archive_files WHERE id = ?`)
          .run(payload.id);
        logActivity(db, actor.userId, 'students.deleteArchiveFile', `archiveFile:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  // =======================================================================
  // Notion 연동 (수동 트리거 동기화)
  // =======================================================================

  ipcMain.handle('notion:getSettings', (event) => {
    requireRole(event, ROLE_SETS.knowledgeEditor);
    // 토큰은 민감 정보이므로 전체 노출 대신 isConfigured 플래그 + 마스킹만 반환.
    const s = NotionSync.getSettings();
    const masked =
      s.token && s.token.length > 8
        ? `${s.token.slice(0, 4)}…${s.token.slice(-4)}`
        : s.token
          ? '••••'
          : '';
    return {
      isConfigured: Boolean(s.token),
      tokenMasked: masked,
      studentDatabases: s.studentDatabases,
      assignmentDatabases: s.assignmentDatabases,
    };
  });

  ipcMain.handle(
    'notion:saveSettings',
    (
      event,
      payload: {
        token?: string;
        studentDatabases?: NotionSettings['studentDatabases'];
        assignmentDatabases?: NotionSettings['assignmentDatabases'];
        actorId?: number | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
      try {
        const patch: Partial<NotionSettings> = {};
        if (payload.token !== undefined) patch.token = payload.token.trim();
        if (payload.studentDatabases !== undefined) {
          patch.studentDatabases = payload.studentDatabases;
        }
        if (payload.assignmentDatabases !== undefined) {
          patch.assignmentDatabases = payload.assignmentDatabases;
        }
        const saved = NotionSync.saveSettings(patch);
        logActivity(getDb(), actor.userId, 'notion.saveSettings', 'notion:settings', {
          tokenChanged: payload.token !== undefined,
          dbsChanged: payload.studentDatabases !== undefined,
          asgDbsChanged: payload.assignmentDatabases !== undefined,
          dbCount: saved.studentDatabases.length,
          asgDbCount: saved.assignmentDatabases.length,
        });
        return {
          ok: true,
          studentDatabases: saved.studentDatabases,
          assignmentDatabases: saved.assignmentDatabases,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'save_failed' };
      }
    },
  );

  ipcMain.handle('notion:probe', async (event, _payload?: { actorId?: number | null }) => {
    const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
    return NotionSync.probe(actor.userId);
  });

  ipcMain.handle(
    'notion:syncStudents',
    async (event, _payload?: { actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
      return NotionSync.syncStudents(actor.userId);
    },
  );

  ipcMain.handle(
    'notion:syncStaff',
    async (event, _payload?: { actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
      return NotionSync.syncStaff(actor.userId);
    },
  );

  ipcMain.handle(
    'notion:syncAssignments',
    async (event, _payload?: { actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
      return NotionSync.syncAssignments(actor.userId);
    },
  );

  ipcMain.handle(
    'notion:listRuns',
    (
      event,
      filter?: {
        limit?: number;
        kind?: 'students' | 'staff' | 'probe' | 'assignments';
      },
    ) => {
      requireRole(event, ROLE_SETS.knowledgeEditor);
      return NotionSync.listRuns({ limit: filter?.limit, kind: filter?.kind });
    },
  );
}
