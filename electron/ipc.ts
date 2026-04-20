import { ipcMain } from 'electron';
import { getDb, getDbPath } from './db';
import { login } from './auth';
import { parseInstructionExcel, type ParsedRow } from './parseExcel';
import {
  calcRegularPayroll,
  calcFreelancerPayroll,
  type RegularPayrollProfile,
  type RegularPayrollInputs,
} from './payroll-calc';

/**
 * Register every IPC handler on the main process.
 * Keep handlers thin — they just call into DB queries.
 */
export function registerIpc(meta: { version: string; platform: string; isDev: boolean }) {
  // -- app info ---------------------------------------------------------------
  ipcMain.handle('app:info', () => ({
    ...meta,
    dbPath: getDbPath(),
  }));

  // -- auth -------------------------------------------------------------------
  ipcMain.handle('auth:login', (_e, payload: { email: string; password: string }) => {
    try {
      const result = login(getDb(), payload.email, payload.password);
      return result;
    } catch (err) {
      console.error('[ipc] auth:login error', err);
      return { ok: false, error: 'server_error' };
    }
  });

  ipcMain.handle('auth:logout', () => ({ ok: true }));

  // -- assignments ------------------------------------------------------------
  ipcMain.handle('assignments:list', (_e, filter?: { state?: string; assignee?: number }) => {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.state) {
      where.push('a.state = ?');
      params.push(filter.state);
    }
    if (filter?.assignee) {
      where.push('(a.parser_id = ? OR a.qa1_id = ? OR a.qa_final_id = ?)');
      params.push(filter.assignee, filter.assignee, filter.assignee);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db
      .prepare(
        `SELECT a.id, a.code, a.subject, a.publisher, a.student_code, a.title,
                a.scope, a.state, a.risk, a.parser_id, a.qa1_id, a.qa_final_id,
                a.due_at, a.received_at, a.completed_at,
                up.name AS parser_name, uq.name AS qa1_name, uf.name AS qa_final_name
           FROM assignments a
           LEFT JOIN users up ON up.id = a.parser_id
           LEFT JOIN users uq ON uq.id = a.qa1_id
           LEFT JOIN users uf ON uf.id = a.qa_final_id
           ${whereSql}
          ORDER BY a.due_at ASC, a.id DESC
          LIMIT 200`,
      )
      .all(...params);
    return rows;
  });

  ipcMain.handle('assignments:get', (_e, id: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT a.*, up.name AS parser_name, uq.name AS qa1_name, uf.name AS qa_final_name
           FROM assignments a
           LEFT JOIN users up ON up.id = a.parser_id
           LEFT JOIN users uq ON uq.id = a.qa1_id
           LEFT JOIN users uf ON uf.id = a.qa_final_id
          WHERE a.id = ?`,
      )
      .get(id);
    return row ?? null;
  });

  /**
   * Transition an assignment to a new state.
   * Very thin — no role check here (UI guards for now). In Phase 2 we'll
   * move role enforcement server-side and log to `activity`.
   */
  ipcMain.handle(
    'assignments:setState',
    (_e, payload: { id: number; state: string; actorId: number; note?: string }) => {
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
          syncAssignmentArchive(db, payload.id, payload.state, payload.actorId);
        }
        return res.changes > 0;
      });
      return { ok: tx() };
    },
  );

  // -- parsing result ---------------------------------------------------------
  ipcMain.handle('assignments:parsingResult', (_e, assignmentId: number) => {
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

  // -- qa review history ------------------------------------------------------
  ipcMain.handle('assignments:qaReviews', (_e, assignmentId: number) => {
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

  // -- notices ----------------------------------------------------------------
  ipcMain.handle('notices:list', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT n.id, n.title, n.body_md, n.audience, n.pinned, n.published_at,
                u.name AS author_name
           FROM notices n
           LEFT JOIN users u ON u.id = n.author_id
          WHERE n.archived_at IS NULL
          ORDER BY n.pinned DESC, n.published_at DESC
          LIMIT 50`,
      )
      .all();
  });

  // -- home dashboard stats ---------------------------------------------------
  ipcMain.handle('home:stats', (_e, userId: number) => {
    const db = getDb();
    const single = (sql: string, ...p: unknown[]) =>
      (db.prepare(sql).get(...p) as { n: number }).n;

    const todayMine = single(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE (parser_id = ? OR qa1_id = ? OR qa_final_id = ?)
          AND state NOT IN ('완료','보류')`,
      userId, userId, userId,
    );
    const dueToday = single(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE (parser_id = ? OR qa1_id = ? OR qa_final_id = ?)
          AND date(due_at) = date('now')`,
      userId, userId, userId,
    );
    const atRisk = single(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE risk = 'high'
          AND state NOT IN ('완료','승인완료','보류')`,
    );
    const rejected = single(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE state IN ('1차QA반려','최종QA반려')
          AND (parser_id = ? OR qa1_id = ? OR qa_final_id = ?)`,
      userId, userId, userId,
    );
    const awaitingApp = single(
      `SELECT COUNT(*) AS n FROM approval_steps s
          JOIN approvals a ON a.id = s.approval_id
         WHERE s.approver_id = ? AND s.state = 'pending' AND a.status = 'pending'`,
      userId,
    );
    const unreadNotice = single(
      `SELECT COUNT(*) AS n FROM notices n
         WHERE n.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = ?)`,
      userId,
    );

    return { todayMine, dueToday, atRisk, rejected, awaitingApp, unreadNotice };
  });

  // -- instruction parsing ----------------------------------------------------
  /**
   * Parse an uploaded Excel buffer. Does NOT write to the DB — the renderer
   * shows a preview and the user commits via `parsing:commit`.
   */
  ipcMain.handle(
    'parsing:preview',
    (_e, payload: { buffer: ArrayBuffer | Uint8Array; filename: string }) => {
      try {
        const buf =
          payload.buffer instanceof Uint8Array
            ? payload.buffer
            : new Uint8Array(payload.buffer);
        const result = parseInstructionExcel(buf, payload.filename ?? 'upload.xlsx');
        return { ok: true, ...result };
      } catch (err) {
        console.error('[ipc] parsing:preview error', err);
        return { ok: false, error: (err as Error).message ?? 'parse_failed' };
      }
    },
  );

  /**
   * Commit previewed rows into the DB — creates one assignment + one
   * parsing_result per valid row. Invalid rows are skipped (returned to renderer).
   */
  ipcMain.handle(
    'parsing:commit',
    (_e, payload: { rows: ParsedRow[]; uploaderId: number; filename: string }) => {
      const db = getDb();
      try {
        const nextCode = db.prepare(
          `SELECT printf('A-%04d', COALESCE(MAX(id), 0) + 1) AS code FROM assignments`,
        );
        const insA = db.prepare(
          `INSERT INTO assignments (code, subject, publisher, student_code, title, scope, state, risk)
           VALUES (@code,@subject,@publisher,@student_code,@title,@scope,'파싱대기','medium')`,
        );
        const insPR = db.prepare(
          `INSERT INTO parsing_results (assignment_id, version, content_json, parsed_by)
           VALUES (?, 1, ?, ?)`,
        );

        const created: Array<{ code: string; rowNumber: number }> = [];
        const skipped: Array<{ rowNumber: number; reason: string }> = [];

        const tx = db.transaction(() => {
          for (const r of payload.rows) {
            if (!r.valid) {
              skipped.push({ rowNumber: r.rowNumber, reason: r.errors.join(', ') });
              continue;
            }
            const { code } = nextCode.get() as { code: string };
            const info = insA.run({
              code,
              subject: r.subject,
              publisher: r.publisher || null,
              student_code: r.studentCode,
              title: r.assignmentTitle,
              scope: r.assignmentScope || null,
            });
            insPR.run(
              Number(info.lastInsertRowid),
              JSON.stringify({
                subject: r.subject,
                publisher: r.publisher,
                studentCode: r.studentCode,
                assignmentTitle: r.assignmentTitle,
                assignmentScope: r.assignmentScope,
                lengthRequirement: r.lengthRequirement,
                outline: r.outline,
                rubric: r.rubric,
                teacherRequirements: r.teacherRequirements,
                studentRequests: r.studentRequests,
                sourceFile: payload.filename,
                sourceRow: r.rowNumber,
              }),
              payload.uploaderId || null,
            );
            created.push({ code, rowNumber: r.rowNumber });
          }
        });
        tx();

        return { ok: true, created, skipped };
      } catch (err) {
        console.error('[ipc] parsing:commit error', err);
        return { ok: false, error: (err as Error).message ?? 'commit_failed' };
      }
    },
  );

  /**
   * Recent parsing activity — last 20 parsed rows with assignment info.
   */
  ipcMain.handle('parsing:recent', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT pr.id, pr.assignment_id, pr.version, pr.confidence, pr.parsed_at,
                a.code, a.subject, a.title, a.state, a.student_code,
                u.name AS parser_name
           FROM parsing_results pr
           JOIN assignments a ON a.id = pr.assignment_id
           LEFT JOIN users u   ON u.id = pr.parsed_by
          ORDER BY pr.parsed_at DESC
          LIMIT 20`,
      )
      .all();
  });

  // -- attendance -------------------------------------------------------------
  /**
   * Return today's attendance row for a user (or null if not checked in yet).
   */
  ipcMain.handle('attendance:today', (_e, userId: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, user_id, work_date, check_in, check_out, break_min, note, created_at
           FROM attendance_records
          WHERE user_id = ? AND work_date = date('now','localtime')`,
      )
      .get(userId);
    return row ?? null;
  });

  /**
   * Check in for today. If already checked in, returns the existing row unchanged.
   */
  ipcMain.handle('attendance:checkIn', (_e, payload: { userId: number; note?: string }) => {
    const db = getDb();
    try {
      const existing = db
        .prepare(
          `SELECT id, check_in FROM attendance_records
            WHERE user_id = ? AND work_date = date('now','localtime')`,
        )
        .get(payload.userId) as { id: number; check_in: string | null } | undefined;
      if (existing?.check_in) {
        return { ok: true, already: true, id: existing.id, checkInAt: existing.check_in };
      }
      const nowIso = new Date().toISOString();
      if (existing) {
        db.prepare(
          `UPDATE attendance_records SET check_in = ?, note = COALESCE(?, note) WHERE id = ?`,
        ).run(nowIso, payload.note ?? null, existing.id);
        return { ok: true, id: existing.id, checkInAt: nowIso };
      }
      const info = db
        .prepare(
          `INSERT INTO attendance_records (user_id, work_date, check_in, break_min, note)
           VALUES (?, date('now','localtime'), ?, 0, ?)`,
        )
        .run(payload.userId, nowIso, payload.note ?? null);
      return { ok: true, id: Number(info.lastInsertRowid), checkInAt: nowIso };
    } catch (err) {
      console.error('[ipc] attendance:checkIn error', err);
      return { ok: false, error: (err as Error).message ?? 'checkin_failed' };
    }
  });

  /**
   * Check out for today. Requires an existing record with check_in.
   * Updates break_min if provided.
   */
  ipcMain.handle(
    'attendance:checkOut',
    (_e, payload: { userId: number; breakMin?: number; note?: string }) => {
      const db = getDb();
      try {
        const existing = db
          .prepare(
            `SELECT id, check_in FROM attendance_records
              WHERE user_id = ? AND work_date = date('now','localtime')`,
          )
          .get(payload.userId) as { id: number; check_in: string | null } | undefined;
        if (!existing || !existing.check_in) {
          return { ok: false, error: 'not_checked_in' };
        }
        const nowIso = new Date().toISOString();
        db.prepare(
          `UPDATE attendance_records
              SET check_out = ?,
                  break_min = COALESCE(?, break_min),
                  note      = COALESCE(?, note)
            WHERE id = ?`,
        ).run(nowIso, payload.breakMin ?? null, payload.note ?? null, existing.id);
        return { ok: true, id: existing.id, checkOutAt: nowIso };
      } catch (err) {
        console.error('[ipc] attendance:checkOut error', err);
        return { ok: false, error: (err as Error).message ?? 'checkout_failed' };
      }
    },
  );

  /**
   * Return attendance rows for a user in YYYY-MM (local time).
   */
  ipcMain.handle(
    'attendance:month',
    (_e, payload: { userId: number; yyyymm: string }) => {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT id, user_id, work_date, check_in, check_out, break_min, note
             FROM attendance_records
            WHERE user_id = ?
              AND substr(work_date, 1, 7) = ?
            ORDER BY work_date DESC`,
        )
        .all(payload.userId, payload.yyyymm);
      return rows;
    },
  );

  /**
   * Monthly summary — worked days, total worked minutes, late count (> 09:10),
   * early leave count (< 18:00 when check_out present).
   */
  ipcMain.handle(
    'attendance:stats',
    (_e, payload: { userId: number; yyyymm: string }) => {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT check_in, check_out, break_min
             FROM attendance_records
            WHERE user_id = ? AND substr(work_date, 1, 7) = ?`,
        )
        .all(payload.userId, payload.yyyymm) as Array<{
        check_in: string | null;
        check_out: string | null;
        break_min: number;
      }>;
      let workedDays = 0;
      let totalMin = 0;
      let late = 0;
      let early = 0;
      for (const r of rows) {
        if (!r.check_in) continue;
        workedDays++;
        const inD = new Date(r.check_in);
        if (inD.getHours() > 9 || (inD.getHours() === 9 && inD.getMinutes() > 10)) late++;
        if (r.check_out) {
          const outD = new Date(r.check_out);
          const mins = Math.max(
            0,
            Math.round((outD.getTime() - inD.getTime()) / 60000) - (r.break_min ?? 0),
          );
          totalMin += mins;
          if (outD.getHours() < 18) early++;
        }
      }
      return { workedDays, totalMin, late, early, avgMin: workedDays ? Math.round(totalMin / workedDays) : 0 };
    },
  );

  // -- leave ------------------------------------------------------------------
  /**
   * Full leave request history — filterable by user or status.
   * Returns joined approver name for UI convenience.
   */
  ipcMain.handle(
    'leave:list',
    (_e, filter?: { userId?: number; status?: string }) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.userId) {
        where.push('r.user_id = ?');
        params.push(filter.userId);
      }
      if (filter?.status) {
        where.push('r.status = ?');
        params.push(filter.status);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      return db
        .prepare(
          `SELECT r.id, r.user_id, r.kind, r.start_date, r.end_date, r.days,
                  r.reason, r.status, r.approver_id, r.decided_at, r.created_at,
                  u.name AS user_name, u.role AS user_role,
                  ap.name AS approver_name
             FROM leave_requests r
             LEFT JOIN users u  ON u.id  = r.user_id
             LEFT JOIN users ap ON ap.id = r.approver_id
             ${whereSql}
            ORDER BY r.created_at DESC
            LIMIT 200`,
        )
        .all(...params);
    },
  );

  /**
   * Return a user's remaining annual leave balance (days).
   */
  ipcMain.handle('leave:balance', (_e, userId: number) => {
    const db = getDb();
    const row = db
      .prepare(`SELECT leave_balance FROM users WHERE id = ?`)
      .get(userId) as { leave_balance: number } | undefined;
    return row ? row.leave_balance : 0;
  });

  /**
   * Submit a new leave request. Server-side recomputes `days` from the date range
   * and leave kind (half → 0.5 regardless of date span).
   */
  ipcMain.handle(
    'leave:create',
    (
      _e,
      payload: {
        userId: number;
        kind: 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special' | 'unpaid';
        startDate: string;
        endDate: string;
        reason?: string;
      },
    ) => {
      const db = getDb();
      try {
        const start = new Date(payload.startDate);
        const end = new Date(payload.endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return { ok: false, error: 'invalid_date' };
        }
        if (end.getTime() < start.getTime()) {
          return { ok: false, error: 'end_before_start' };
        }
        const isHalf = payload.kind === 'half_am' || payload.kind === 'half_pm';
        let days = isHalf
          ? 0.5
          : Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

        // For annual leave — must have enough balance
        if (payload.kind === 'annual' || isHalf) {
          const bal = (db.prepare(`SELECT leave_balance FROM users WHERE id = ?`)
            .get(payload.userId) as { leave_balance: number } | undefined)?.leave_balance ?? 0;
          if (bal < days) return { ok: false, error: `insufficient_balance (보유 ${bal}일)` };
        }

        const info = db
          .prepare(
            `INSERT INTO leave_requests
               (user_id, kind, start_date, end_date, days, reason, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          )
          .run(
            payload.userId,
            payload.kind,
            payload.startDate,
            payload.endDate,
            days,
            payload.reason ?? null,
          );
        return { ok: true, id: Number(info.lastInsertRowid), days };
      } catch (err) {
        console.error('[ipc] leave:create error', err);
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  /**
   * Approve / reject a pending leave request.
   *  - On approve: deduct days from users.leave_balance (only annual + half_*).
   *  - On reject: balance is NOT touched.
   *  - Runs inside a transaction so the two writes stay consistent.
   */
  ipcMain.handle(
    'leave:decide',
    (
      _e,
      payload: {
        id: number;
        approverId: number;
        decision: 'approved' | 'rejected';
        comment?: string;
      },
    ) => {
      const db = getDb();
      try {
        const req = db
          .prepare(
            `SELECT id, user_id, kind, days, status FROM leave_requests WHERE id = ?`,
          )
          .get(payload.id) as
          | { id: number; user_id: number; kind: string; days: number; status: string }
          | undefined;
        if (!req) return { ok: false, error: 'not_found' };
        if (req.status !== 'pending') return { ok: false, error: 'already_decided' };

        const nowIso = new Date().toISOString();
        const deducts =
          payload.decision === 'approved' &&
          (req.kind === 'annual' || req.kind === 'half_am' || req.kind === 'half_pm');

        const tx = db.transaction(() => {
          db.prepare(
            `UPDATE leave_requests
                SET status = ?, approver_id = ?, decided_at = ?,
                    reason = CASE WHEN ? IS NOT NULL THEN COALESCE(reason, '') || CHAR(10) || '[결재] ' || ? ELSE reason END
              WHERE id = ?`,
          ).run(
            payload.decision,
            payload.approverId,
            nowIso,
            payload.comment ?? null,
            payload.comment ?? null,
            payload.id,
          );
          if (deducts) {
            db.prepare(
              `UPDATE users SET leave_balance = leave_balance - ? WHERE id = ?`,
            ).run(req.days, req.user_id);
          }
        });
        tx();
        return { ok: true, deducted: deducts ? req.days : 0 };
      } catch (err) {
        console.error('[ipc] leave:decide error', err);
        return { ok: false, error: (err as Error).message ?? 'decide_failed' };
      }
    },
  );

  /**
   * Cancel a pending (own) leave request.
   */
  ipcMain.handle(
    'leave:cancel',
    (_e, payload: { id: number; userId: number }) => {
      const db = getDb();
      const res = db
        .prepare(
          `UPDATE leave_requests
              SET status = 'cancelled', decided_at = datetime('now')
            WHERE id = ? AND user_id = ? AND status = 'pending'`,
        )
        .run(payload.id, payload.userId);
      return { ok: res.changes > 0 };
    },
  );

  // ===========================================================================
  // CS tickets
  // ===========================================================================

  ipcMain.handle(
    'cs:list',
    (_e, filter?: { status?: string; assigneeId?: number; priority?: string }) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.status) {
        where.push('t.status = ?');
        params.push(filter.status);
      }
      if (filter?.assigneeId) {
        where.push('t.assignee_id = ?');
        params.push(filter.assigneeId);
      }
      if (filter?.priority) {
        where.push('t.priority = ?');
        params.push(filter.priority);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      return db
        .prepare(
          `SELECT t.id, t.code, t.channel, t.student_code, t.inquirer, t.subject, t.body,
                  t.priority, t.status, t.assignee_id, t.related_assignment_id,
                  t.opened_at, t.resolved_at,
                  u.name AS assignee_name,
                  a.code AS related_code, a.title AS related_title
             FROM cs_tickets t
             LEFT JOIN users u       ON u.id = t.assignee_id
             LEFT JOIN assignments a ON a.id = t.related_assignment_id
             ${whereSql}
            ORDER BY
              CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
              t.opened_at DESC
            LIMIT 200`,
        )
        .all(...params);
    },
  );

  ipcMain.handle('cs:get', (_e, id: number) => {
    const db = getDb();
    return (
      db
        .prepare(
          `SELECT t.*, u.name AS assignee_name, a.code AS related_code, a.title AS related_title
             FROM cs_tickets t
             LEFT JOIN users u       ON u.id = t.assignee_id
             LEFT JOIN assignments a ON a.id = t.related_assignment_id
            WHERE t.id = ?`,
        )
        .get(id) ?? null
    );
  });

  ipcMain.handle(
    'cs:create',
    (
      _e,
      payload: {
        channel: 'phone' | 'email' | 'kakao' | 'other';
        studentCode?: string;
        inquirer?: string;
        subject: string;
        body?: string;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        assigneeId?: number;
        relatedAssignmentId?: number;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const { code } = db
          .prepare(
            `SELECT printf('CS-%04d', COALESCE(MAX(id), 0) + 1) AS code FROM cs_tickets`,
          )
          .get() as { code: string };
        const info = db
          .prepare(
            `INSERT INTO cs_tickets
               (code, channel, student_code, inquirer, subject, body, priority, status,
                assignee_id, related_assignment_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
          )
          .run(
            code,
            payload.channel,
            payload.studentCode ?? null,
            payload.inquirer ?? null,
            payload.subject,
            payload.body ?? null,
            payload.priority ?? 'normal',
            payload.assigneeId ?? null,
            payload.relatedAssignmentId ?? null,
          );
        logActivity(db, payload.actorId, 'cs.create', `cs:${info.lastInsertRowid}`, { code });
        return { ok: true, id: Number(info.lastInsertRowid), code };
      } catch (err) {
        console.error('[ipc] cs:create error', err);
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  ipcMain.handle(
    'cs:update',
    (
      _e,
      payload: {
        id: number;
        status?: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        assigneeId?: number | null;
        body?: string;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (payload.status !== undefined) {
          sets.push('status = ?');
          params.push(payload.status);
          if (payload.status === 'resolved' || payload.status === 'closed') {
            sets.push(`resolved_at = COALESCE(resolved_at, datetime('now'))`);
          }
        }
        if (payload.priority !== undefined) {
          sets.push('priority = ?');
          params.push(payload.priority);
        }
        if (payload.assigneeId !== undefined) {
          sets.push('assignee_id = ?');
          params.push(payload.assigneeId);
        }
        if (payload.body !== undefined) {
          sets.push('body = ?');
          params.push(payload.body);
        }
        if (!sets.length) return { ok: false, error: 'nothing_to_update' };
        params.push(payload.id);
        const res = db
          .prepare(`UPDATE cs_tickets SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
        logActivity(db, payload.actorId, 'cs.update', `cs:${payload.id}`, { sets: sets.length });
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] cs:update error', err);
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle('cs:stats', () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM cs_tickets GROUP BY status`,
      )
      .all() as Array<{ status: string; n: number }>;
    const out: Record<string, number> = { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  });

  // ===========================================================================
  // Approvals (전자 결재 다단계)
  // ===========================================================================

  ipcMain.handle(
    'approvals:list',
    (_e, filter?: { drafterId?: number; approverId?: number; status?: string }) => {
      const db = getDb();
      if (filter?.approverId) {
        return db
          .prepare(
            `SELECT a.id, a.code, a.title, a.kind, a.drafter_id, a.status, a.drafted_at, a.closed_at,
                    u.name AS drafter_name,
                    s.step_order AS my_step, s.state AS my_state, s.id AS my_step_id
               FROM approvals a
               JOIN approval_steps s ON s.approval_id = a.id AND s.approver_id = ?
               LEFT JOIN users u     ON u.id = a.drafter_id
              WHERE (? IS NULL OR a.status = ?)
              ORDER BY a.drafted_at DESC
              LIMIT 200`,
          )
          .all(filter.approverId, filter.status ?? null, filter.status ?? null);
      }
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.drafterId) {
        where.push('a.drafter_id = ?');
        params.push(filter.drafterId);
      }
      if (filter?.status) {
        where.push('a.status = ?');
        params.push(filter.status);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      return db
        .prepare(
          `SELECT a.id, a.code, a.title, a.kind, a.drafter_id, a.status, a.drafted_at, a.closed_at,
                  u.name AS drafter_name
             FROM approvals a
             LEFT JOIN users u ON u.id = a.drafter_id
             ${whereSql}
            ORDER BY a.drafted_at DESC
            LIMIT 200`,
        )
        .all(...params);
    },
  );

  ipcMain.handle('approvals:get', (_e, id: number) => {
    const db = getDb();
    const header = db
      .prepare(
        `SELECT a.*, u.name AS drafter_name
           FROM approvals a
           LEFT JOIN users u ON u.id = a.drafter_id
          WHERE a.id = ?`,
      )
      .get(id);
    if (!header) return null;
    const steps = db
      .prepare(
        `SELECT s.id, s.step_order, s.approver_id, s.state, s.comment, s.decided_at,
                u.name AS approver_name, u.role AS approver_role
           FROM approval_steps s
           LEFT JOIN users u ON u.id = s.approver_id
          WHERE s.approval_id = ?
          ORDER BY s.step_order`,
      )
      .all(id);
    return { ...header, steps };
  });

  ipcMain.handle(
    'approvals:create',
    (
      _e,
      payload: {
        drafterId: number;
        title: string;
        kind: string;
        payload?: Record<string, unknown>;
        approverIds: number[];
      },
    ) => {
      const db = getDb();
      try {
        if (!payload.approverIds.length) return { ok: false, error: 'no_approvers' };
        const { code } = db
          .prepare(
            `SELECT printf('AP-%04d', COALESCE(MAX(id), 0) + 1) AS code FROM approvals`,
          )
          .get() as { code: string };
        const tx = db.transaction(() => {
          const info = db
            .prepare(
              `INSERT INTO approvals (code, title, kind, drafter_id, payload_json, status)
               VALUES (?, ?, ?, ?, ?, 'pending')`,
            )
            .run(
              code,
              payload.title,
              payload.kind,
              payload.drafterId,
              payload.payload ? JSON.stringify(payload.payload) : null,
            );
          const aid = Number(info.lastInsertRowid);
          const insStep = db.prepare(
            `INSERT INTO approval_steps (approval_id, step_order, approver_id, state)
             VALUES (?, ?, ?, 'pending')`,
          );
          payload.approverIds.forEach((uid, idx) => insStep.run(aid, idx + 1, uid));
          return { aid, code };
        });
        const res = tx();
        logActivity(db, payload.drafterId, 'approvals.create', `approval:${res.aid}`, {
          code: res.code,
        });
        return { ok: true, id: res.aid, code: res.code };
      } catch (err) {
        console.error('[ipc] approvals:create error', err);
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  ipcMain.handle(
    'approvals:decide',
    (
      _e,
      payload: {
        approvalId: number;
        approverId: number;
        decision: 'approved' | 'rejected';
        comment?: string;
      },
    ) => {
      const db = getDb();
      try {
        const approval = db
          .prepare(`SELECT id, status FROM approvals WHERE id = ?`)
          .get(payload.approvalId) as { id: number; status: string } | undefined;
        if (!approval) return { ok: false, error: 'not_found' };
        if (approval.status !== 'pending') return { ok: false, error: 'already_closed' };

        const myStep = db
          .prepare(
            `SELECT id, step_order, state FROM approval_steps
              WHERE approval_id = ? AND approver_id = ? AND state = 'pending'
              ORDER BY step_order ASC LIMIT 1`,
          )
          .get(payload.approvalId, payload.approverId) as
          | { id: number; step_order: number; state: string }
          | undefined;
        if (!myStep) return { ok: false, error: 'not_your_turn' };

        // Only the earliest pending step may decide.
        const earliest = db
          .prepare(
            `SELECT step_order FROM approval_steps
              WHERE approval_id = ? AND state = 'pending'
              ORDER BY step_order ASC LIMIT 1`,
          )
          .get(payload.approvalId) as { step_order: number } | undefined;
        if (earliest && earliest.step_order !== myStep.step_order) {
          return { ok: false, error: 'waiting_earlier_step' };
        }

        const nowIso = new Date().toISOString();
        const tx = db.transaction(() => {
          db.prepare(
            `UPDATE approval_steps SET state = ?, comment = ?, decided_at = ? WHERE id = ?`,
          ).run(payload.decision, payload.comment ?? null, nowIso, myStep.id);

          if (payload.decision === 'rejected') {
            db.prepare(
              `UPDATE approvals SET status = 'rejected', closed_at = ? WHERE id = ?`,
            ).run(nowIso, payload.approvalId);
            return { finalStatus: 'rejected' as const };
          }
          // approved — if no more pending, close as approved
          const remaining = (
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM approval_steps WHERE approval_id = ? AND state = 'pending'`,
              )
              .get(payload.approvalId) as { n: number }
          ).n;
          if (remaining === 0) {
            db.prepare(
              `UPDATE approvals SET status = 'approved', closed_at = ? WHERE id = ?`,
            ).run(nowIso, payload.approvalId);
            return { finalStatus: 'approved' as const };
          }
          return { finalStatus: 'pending' as const };
        });
        const res = tx();
        logActivity(db, payload.approverId, 'approvals.decide', `approval:${payload.approvalId}`, {
          decision: payload.decision,
          finalStatus: res.finalStatus,
        });
        return { ok: true, finalStatus: res.finalStatus };
      } catch (err) {
        console.error('[ipc] approvals:decide error', err);
        return { ok: false, error: (err as Error).message ?? 'decide_failed' };
      }
    },
  );

  ipcMain.handle(
    'approvals:withdraw',
    (_e, payload: { approvalId: number; drafterId: number }) => {
      const db = getDb();
      const res = db
        .prepare(
          `UPDATE approvals SET status = 'withdrawn', closed_at = datetime('now')
            WHERE id = ? AND drafter_id = ? AND status = 'pending'`,
        )
        .run(payload.approvalId, payload.drafterId);
      logActivity(db, payload.drafterId, 'approvals.withdraw', `approval:${payload.approvalId}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ===========================================================================
  // Operations board
  // ===========================================================================

  ipcMain.handle('board:summary', () => {
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

  ipcMain.handle('qa:templates', (_e, stage: 'QA1' | 'QA_FINAL') => {
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
      _e,
      payload: {
        assignmentId: number;
        stage: 'QA1' | 'QA_FINAL';
        reviewerId: number;
        result: 'approved' | 'rejected' | 'revision_requested';
        checklist: Record<string, { checked: boolean; note?: string }>;
        comment?: string;
      },
    ) => {
      const db = getDb();
      try {
        const nowIso = new Date().toISOString();
        const transitions: Record<string, Record<string, string>> = {
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
        const nextState = transitions[payload.stage][payload.result];
        const tx = db.transaction(() => {
          db.prepare(
            `INSERT INTO qa_reviews
               (assignment_id, stage, reviewer_id, result, checklist_json, comment)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            payload.assignmentId,
            payload.stage,
            payload.reviewerId,
            payload.result,
            JSON.stringify(payload.checklist),
            payload.comment ?? null,
          );
          db.prepare(
            `UPDATE assignments
                SET state = ?, updated_at = ?,
                    completed_at = CASE WHEN ? = '승인완료' THEN ? ELSE completed_at END
              WHERE id = ?`,
          ).run(nextState, nowIso, nextState, nowIso, payload.assignmentId);
          // 최종 승인 → 보관함에 자동 추가 / 그 외 상태로 바뀌면 자동 레코드 제거
          syncAssignmentArchive(db, payload.assignmentId, nextState, payload.reviewerId);
        });
        tx();
        logActivity(db, payload.reviewerId, 'qa.submit', `assignment:${payload.assignmentId}`, {
          stage: payload.stage,
          result: payload.result,
          nextState,
        });
        return { ok: true, nextState };
      } catch (err) {
        console.error('[ipc] qa:submit error', err);
        return { ok: false, error: (err as Error).message ?? 'submit_failed' };
      }
    },
  );

  // ===========================================================================
  // Manual wiki pages
  // ===========================================================================

  ipcMain.handle('manuals:list', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, slug, title, category, parent_id, version, updated_at
           FROM manual_pages
          ORDER BY COALESCE(category, 'ZZZ'), title`,
      )
      .all();
  });

  ipcMain.handle('manuals:get', (_e, slug: string) => {
    const db = getDb();
    return (
      db
        .prepare(
          `SELECT m.id, m.slug, m.title, m.body_md, m.category, m.parent_id, m.version,
                  m.updated_at, m.created_at, u.name AS author_name
             FROM manual_pages m
             LEFT JOIN users u ON u.id = m.author_id
            WHERE m.slug = ?`,
        )
        .get(slug) ?? null
    );
  });

  ipcMain.handle(
    'manuals:save',
    (
      _e,
      payload: {
        id?: number;
        slug: string;
        title: string;
        bodyMd: string;
        category?: string;
        authorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const nowIso = new Date().toISOString();
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE manual_pages
                  SET title = ?, body_md = ?, category = ?, author_id = ?,
                      version = version + 1, updated_at = ?
                WHERE id = ?`,
            )
            .run(
              payload.title,
              payload.bodyMd,
              payload.category ?? null,
              payload.authorId,
              nowIso,
              payload.id,
            );
          logActivity(db, payload.authorId, 'manuals.update', `manual:${payload.id}`, {
            slug: payload.slug,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        const info = db
          .prepare(
            `INSERT INTO manual_pages (slug, title, body_md, category, author_id)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            payload.slug,
            payload.title,
            payload.bodyMd,
            payload.category ?? null,
            payload.authorId,
          );
        logActivity(db, payload.authorId, 'manuals.create', `manual:${info.lastInsertRowid}`, {
          slug: payload.slug,
        });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        console.error('[ipc] manuals:save error', err);
        return { ok: false, error: (err as Error).message ?? 'save_failed' };
      }
    },
  );

  ipcMain.handle(
    'manuals:delete',
    (_e, payload: { id: number; actorId: number }) => {
      const db = getDb();
      const res = db.prepare(`DELETE FROM manual_pages WHERE id = ?`).run(payload.id);
      logActivity(db, payload.actorId, 'manuals.delete', `manual:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ===========================================================================
  // Reports / KPI dashboard
  // ===========================================================================

  ipcMain.handle('reports:kpi', () => {
    const db = getDb();
    const count = (sql: string, ...p: unknown[]) =>
      (db.prepare(sql).get(...p) as { n: number }).n;
    const avg = (sql: string, ...p: unknown[]) =>
      (db.prepare(sql).get(...p) as { v: number | null }).v ?? 0;

    const assignmentsOpen = count(
      `SELECT COUNT(*) AS n FROM assignments WHERE state NOT IN ('완료','승인완료','보류')`,
    );
    const completedThisMonth = count(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE state IN ('완료','승인완료')
          AND substr(COALESCE(completed_at, updated_at), 1, 7) = strftime('%Y-%m','now','localtime')`,
    );
    const qaRejectRate = Math.round(
      avg(
        `SELECT CASE WHEN COUNT(*) = 0 THEN 0
                     ELSE 100.0 * SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) / COUNT(*)
                END AS v
           FROM qa_reviews
          WHERE substr(reviewed_at, 1, 7) = strftime('%Y-%m','now','localtime')`,
      ),
    );
    const csOpen = count(
      `SELECT COUNT(*) AS n FROM cs_tickets WHERE status IN ('open','in_progress','waiting')`,
    );
    const csAvgMins = Math.round(
      avg(
        `SELECT AVG( (julianday(resolved_at) - julianday(opened_at)) * 24 * 60 ) AS v
           FROM cs_tickets
          WHERE resolved_at IS NOT NULL
            AND substr(opened_at, 1, 7) = strftime('%Y-%m','now','localtime')`,
      ),
    );
    const attendanceLate = count(
      `SELECT COUNT(*) AS n FROM attendance_records
        WHERE check_in IS NOT NULL
          AND substr(work_date, 1, 7) = strftime('%Y-%m','now','localtime')
          AND (CAST(substr(check_in, 12, 2) AS INTEGER) > 9
            OR (CAST(substr(check_in, 12, 2) AS INTEGER) = 9
                AND CAST(substr(check_in, 15, 2) AS INTEGER) > 10))`,
    );
    const pendingApprovals = count(
      `SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`,
    );

    // Weekly processing trend — last 14 days
    const daily = db
      .prepare(
        `SELECT date(completed_at,'localtime') AS d, COUNT(*) AS n
           FROM assignments
          WHERE completed_at IS NOT NULL
            AND completed_at >= datetime('now','-13 days')
          GROUP BY d ORDER BY d`,
      )
      .all() as Array<{ d: string; n: number }>;

    return {
      assignmentsOpen,
      completedThisMonth,
      qaRejectRate,
      csOpen,
      csAvgMins,
      attendanceLate,
      pendingApprovals,
      daily,
    };
  });

  // ===========================================================================
  // Activity logs + admin settings
  // ===========================================================================

  ipcMain.handle(
    'logs:list',
    (_e, filter?: { action?: string; limit?: number }) => {
      const db = getDb();
      const lim = Math.min(Math.max(filter?.limit ?? 100, 1), 500);
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.action) {
        where.push('l.action LIKE ?');
        params.push(`%${filter.action}%`);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      return db
        .prepare(
          `SELECT l.id, l.actor_id, l.action, l.target, l.meta_json, l.created_at,
                  u.name AS actor_name, u.role AS actor_role
             FROM activity_logs l
             LEFT JOIN users u ON u.id = l.actor_id
             ${whereSql}
            ORDER BY l.created_at DESC
            LIMIT ${lim}`,
        )
        .all(...params);
    },
  );

  ipcMain.handle('settings:list', () => {
    const db = getDb();
    return db
      .prepare(`SELECT key, value_json, updated_at FROM admin_settings ORDER BY key`)
      .all();
  });

  ipcMain.handle(
    'settings:set',
    (_e, payload: { key: string; valueJson: string; actorId: number }) => {
      const db = getDb();
      try {
        // Validate JSON parseability
        JSON.parse(payload.valueJson);
        db.prepare(
          `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
           VALUES (?, ?, datetime('now'))`,
        ).run(payload.key, payload.valueJson);
        logActivity(db, payload.actorId, 'settings.set', `setting:${payload.key}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'invalid_json' };
      }
    },
  );

  // ===========================================================================
  // Employees / users (HR)
  // ===========================================================================

  ipcMain.handle('users:list', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.department_id, d.name AS department_name,
                u.title, u.phone, u.active, u.leave_balance, u.joined_at, u.created_at
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
          ORDER BY u.active DESC, u.role, u.name`,
      )
      .all();
  });

  ipcMain.handle(
    'users:update',
    (
      _e,
      payload: {
        id: number;
        role?: string;
        departmentId?: number | null;
        title?: string | null;
        phone?: string | null;
        active?: boolean;
        leaveBalance?: number;
        actorId: number;
      },
    ) => {
      const db = getDb();
      const sets: string[] = [];
      const params: unknown[] = [];
      if (payload.role !== undefined) {
        sets.push('role = ?');
        params.push(payload.role);
      }
      if (payload.departmentId !== undefined) {
        sets.push('department_id = ?');
        params.push(payload.departmentId);
      }
      if (payload.title !== undefined) {
        sets.push('title = ?');
        params.push(payload.title);
      }
      if (payload.phone !== undefined) {
        sets.push('phone = ?');
        params.push(payload.phone);
      }
      if (payload.active !== undefined) {
        sets.push('active = ?');
        params.push(payload.active ? 1 : 0);
      }
      if (payload.leaveBalance !== undefined) {
        sets.push('leave_balance = ?');
        params.push(payload.leaveBalance);
      }
      if (!sets.length) return { ok: false, error: 'nothing_to_update' };
      sets.push(`updated_at = datetime('now')`);
      params.push(payload.id);
      const res = db
        .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params);
      logActivity(db, payload.actorId, 'users.update', `user:${payload.id}`, { sets: sets.length });
      return { ok: res.changes > 0 };
    },
  );

  ipcMain.handle('departments:list', () => {
    const db = getDb();
    return db.prepare(`SELECT id, name, parent_id FROM departments ORDER BY id`).all();
  });

  // ===========================================================================
  // Notices (expanded)
  // ===========================================================================

  ipcMain.handle(
    'notices:create',
    (
      _e,
      payload: {
        authorId: number;
        title: string;
        bodyMd: string;
        audience?: string;
        pinned?: boolean;
      },
    ) => {
      const db = getDb();
      try {
        const info = db
          .prepare(
            `INSERT INTO notices (title, body_md, author_id, audience, pinned)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            payload.title,
            payload.bodyMd,
            payload.authorId,
            payload.audience ?? 'ALL',
            payload.pinned ? 1 : 0,
          );
        logActivity(db, payload.authorId, 'notices.create', `notice:${info.lastInsertRowid}`, {});
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  ipcMain.handle(
    'notices:archive',
    (_e, payload: { id: number; actorId: number }) => {
      const db = getDb();
      const res = db
        .prepare(`UPDATE notices SET archived_at = datetime('now') WHERE id = ?`)
        .run(payload.id);
      logActivity(db, payload.actorId, 'notices.archive', `notice:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ===========================================================================
  // Documents (자료실)
  // ===========================================================================

  ipcMain.handle('documents:list', (_e, folder?: string) => {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    if (folder) {
      where.push('d.folder = ?');
      params.push(folder);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return db
      .prepare(
        `SELECT d.id, d.name, d.folder, d.tags, d.size_bytes, d.mime_type, d.uploaded_at,
                u.name AS uploader_name
           FROM documents d
           LEFT JOIN users u ON u.id = d.uploaded_by
           ${whereSql}
          ORDER BY d.uploaded_at DESC
          LIMIT 200`,
      )
      .all(...params);
  });

  ipcMain.handle(
    'documents:create',
    (
      _e,
      payload: {
        name: string;
        folder?: string;
        tags?: string;
        mimeType?: string;
        sizeBytes?: number;
        uploaderId: number;
      },
    ) => {
      const db = getDb();
      try {
        const info = db
          .prepare(
            `INSERT INTO documents (name, stored_path, folder, tags, mime_type, size_bytes, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.name,
            `local://${payload.name}`,
            payload.folder ?? null,
            payload.tags ?? null,
            payload.mimeType ?? null,
            payload.sizeBytes ?? null,
            payload.uploaderId,
          );
        logActivity(db, payload.uploaderId, 'documents.create', `doc:${info.lastInsertRowid}`, {
          name: payload.name,
        });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  // ===========================================================================
  // Work logs (업무 일지)
  // ===========================================================================

  ipcMain.handle(
    'workLogs:list',
    (
      _e,
      filter?: { userId?: number; from?: string; to?: string; limit?: number },
    ) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.userId != null) {
        where.push('w.user_id = ?');
        params.push(filter.userId);
      }
      if (filter?.from) {
        where.push('w.log_date >= ?');
        params.push(filter.from);
      }
      if (filter?.to) {
        where.push('w.log_date <= ?');
        params.push(filter.to);
      }
      const lim = Math.min(Math.max(filter?.limit ?? 60, 1), 365);
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      return db
        .prepare(
          `SELECT w.id, w.user_id, w.log_date, w.summary, w.details, w.tags, w.created_at,
                  u.name AS user_name
             FROM work_logs w
             LEFT JOIN users u ON u.id = w.user_id
             ${whereSql}
            ORDER BY w.log_date DESC, w.created_at DESC
            LIMIT ${lim}`,
        )
        .all(...params);
    },
  );

  ipcMain.handle(
    'workLogs:create',
    (
      _e,
      payload: {
        userId: number;
        logDate: string;
        summary: string;
        details?: string;
        tags?: string;
      },
    ) => {
      const db = getDb();
      try {
        if (!payload.summary?.trim()) {
          return { ok: false, error: '요약을 입력해 주세요.' };
        }
        if (!payload.logDate) {
          return { ok: false, error: '날짜를 선택해 주세요.' };
        }
        const info = db
          .prepare(
            `INSERT INTO work_logs (user_id, log_date, summary, details, tags)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            payload.userId,
            payload.logDate,
            payload.summary.trim(),
            payload.details?.trim() ?? null,
            payload.tags?.trim() ?? null,
          );
        logActivity(db, payload.userId, 'workLogs.create', `log:${info.lastInsertRowid}`, {
          date: payload.logDate,
        });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  ipcMain.handle(
    'workLogs:update',
    (
      _e,
      payload: {
        id: number;
        userId: number;
        summary?: string;
        details?: string;
        tags?: string;
      },
    ) => {
      const db = getDb();
      try {
        const row = db
          .prepare(`SELECT user_id FROM work_logs WHERE id = ?`)
          .get(payload.id) as { user_id: number } | undefined;
        if (!row) return { ok: false, error: 'not_found' };
        if (row.user_id !== payload.userId) {
          return { ok: false, error: '본인의 일지만 수정할 수 있습니다.' };
        }
        const sets: string[] = [];
        const params: unknown[] = [];
        if (payload.summary !== undefined) {
          sets.push('summary = ?');
          params.push(payload.summary.trim());
        }
        if (payload.details !== undefined) {
          sets.push('details = ?');
          params.push(payload.details.trim() || null);
        }
        if (payload.tags !== undefined) {
          sets.push('tags = ?');
          params.push(payload.tags.trim() || null);
        }
        if (!sets.length) return { ok: true };
        params.push(payload.id);
        db.prepare(`UPDATE work_logs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        logActivity(db, payload.userId, 'workLogs.update', `log:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle(
    'workLogs:delete',
    (_e, payload: { id: number; userId: number }) => {
      const db = getDb();
      try {
        const row = db
          .prepare(`SELECT user_id FROM work_logs WHERE id = ?`)
          .get(payload.id) as { user_id: number } | undefined;
        if (!row) return { ok: false, error: 'not_found' };
        if (row.user_id !== payload.userId) {
          return { ok: false, error: '본인의 일지만 삭제할 수 있습니다.' };
        }
        db.prepare(`DELETE FROM work_logs WHERE id = ?`).run(payload.id);
        logActivity(db, payload.userId, 'workLogs.delete', `log:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  registerAdminIpc();
  registerStudentArchiveIpc();
}

// ===========================================================================
// Administrative IPC — tuition / payroll / subscriptions / corporate cards
// Broken into its own function so the file stays navigable.
// ===========================================================================
function registerAdminIpc() {
  // -------------------------------------------------------------------------
  // Tuition billing
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'tuition:listStudents',
    (_e, filter?: { active?: boolean; search?: string }) => {
      const db = getDb();
      const where: string[] = ['s.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter?.active === true) {
        where.push('s.billing_active = 1');
      } else if (filter?.active === false) {
        where.push('s.billing_active = 0');
      }
      if (filter?.search) {
        where.push('(s.name LIKE ? OR s.student_code LIKE ?)');
        const q = `%${filter.search}%`;
        params.push(q, q);
      }
      const rows = db
        .prepare(
          `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.guardian,
                  s.monthly_fee, s.billing_day, s.billing_active, s.memo
             FROM students s
            WHERE ${where.join(' AND ')}
            ORDER BY s.student_code ASC
            LIMIT 500`,
        )
        .all(...params);
      return rows;
    },
  );

  ipcMain.handle(
    'tuition:updateStudentBilling',
    (
      _e,
      payload: {
        studentId: number;
        monthlyFee?: number;
        billingDay?: number;
        billingActive?: boolean;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (typeof payload.monthlyFee === 'number') {
          sets.push('monthly_fee = ?');
          params.push(Math.max(0, Math.floor(payload.monthlyFee)));
        }
        if (typeof payload.billingDay === 'number') {
          const d = Math.min(28, Math.max(1, Math.floor(payload.billingDay)));
          sets.push('billing_day = ?');
          params.push(d);
        }
        if (typeof payload.billingActive === 'boolean') {
          sets.push('billing_active = ?');
          params.push(payload.billingActive ? 1 : 0);
        }
        if (sets.length === 0) return { ok: false, error: 'nothing_to_update' };
        params.push(payload.studentId);
        const res = db
          .prepare(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
        logActivity(db, payload.actorId, 'tuition.updateStudentBilling', `student:${payload.studentId}`, {
          monthlyFee: payload.monthlyFee,
          billingDay: payload.billingDay,
          billingActive: payload.billingActive,
        });
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle(
    'tuition:listInvoices',
    (_e, filter?: { period?: string; status?: string; studentId?: number }) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.period) {
        where.push('i.period_yyyymm = ?');
        params.push(filter.period);
      }
      if (filter?.status) {
        where.push('i.status = ?');
        params.push(filter.status);
      }
      if (typeof filter?.studentId === 'number') {
        where.push('i.student_id = ?');
        params.push(filter.studentId);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const rows = db
        .prepare(
          `SELECT i.id, i.student_id, i.student_code, i.period_yyyymm, i.due_date,
                  i.base_amount, i.discount, i.adjustment, i.total_amount, i.paid_amount,
                  i.status, i.memo, i.created_at, i.updated_at,
                  s.name AS student_name, s.grade AS student_grade
             FROM tuition_invoices i
             LEFT JOIN students s ON s.id = i.student_id
             ${whereSql}
            ORDER BY i.period_yyyymm DESC, i.student_code ASC
            LIMIT 1000`,
        )
        .all(...params);
      return rows;
    },
  );

  ipcMain.handle(
    'tuition:generateMonthly',
    (
      _e,
      payload: { period: string; dueDate?: string; actorId: number; overwrite?: boolean },
    ) => {
      const db = getDb();
      try {
        const students = db
          .prepare(
            `SELECT id, student_code, monthly_fee, billing_day
               FROM students
              WHERE deleted_at IS NULL AND billing_active = 1 AND monthly_fee > 0`,
          )
          .all() as {
          id: number;
          student_code: string;
          monthly_fee: number;
          billing_day: number;
        }[];

        let created = 0;
        let skipped = 0;
        const [yy, mm] = payload.period.split('-');
        const periodYY = Number(yy);
        const periodMM = Number(mm);

        const insertStmt = db.prepare(
          `INSERT INTO tuition_invoices (
             student_id, student_code, period_yyyymm, due_date,
             base_amount, discount, adjustment, total_amount, paid_amount, status, created_by
           ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, 'unpaid', ?)`,
        );
        const existsStmt = db.prepare(
          `SELECT id FROM tuition_invoices WHERE student_id = ? AND period_yyyymm = ?`,
        );
        const deleteStmt = db.prepare(
          `DELETE FROM tuition_invoices WHERE student_id = ? AND period_yyyymm = ? AND paid_amount = 0`,
        );

        const tx = db.transaction(() => {
          for (const s of students) {
            const exists = existsStmt.get(s.id, payload.period);
            if (exists && !payload.overwrite) {
              skipped += 1;
              continue;
            }
            if (exists && payload.overwrite) {
              const removed = deleteStmt.run(s.id, payload.period);
              if (removed.changes === 0) {
                // Already had paid amounts — don't blow it away.
                skipped += 1;
                continue;
              }
            }
            const due =
              payload.dueDate ??
              (Number.isFinite(periodYY) && Number.isFinite(periodMM)
                ? `${payload.period}-${String(
                    Math.min(28, Math.max(1, s.billing_day || 5)),
                  ).padStart(2, '0')}`
                : null);
            insertStmt.run(
              s.id,
              s.student_code,
              payload.period,
              due,
              s.monthly_fee,
              s.monthly_fee,
              payload.actorId,
            );
            created += 1;
          }
        });
        tx();

        logActivity(db, payload.actorId, 'tuition.generateMonthly', `period:${payload.period}`, {
          created,
          skipped,
          overwrite: !!payload.overwrite,
        });
        return { ok: true, created, skipped };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'generate_failed' };
      }
    },
  );

  ipcMain.handle(
    'tuition:updateInvoice',
    (
      _e,
      payload: {
        id: number;
        baseAmount?: number;
        discount?: number;
        adjustment?: number;
        dueDate?: string | null;
        memo?: string | null;
        status?: 'unpaid' | 'partial' | 'paid' | 'waived' | 'cancelled';
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const cur = db
          .prepare(
            `SELECT id, base_amount, discount, adjustment, total_amount, paid_amount, status
               FROM tuition_invoices WHERE id = ?`,
          )
          .get(payload.id) as
          | {
              id: number;
              base_amount: number;
              discount: number;
              adjustment: number;
              total_amount: number;
              paid_amount: number;
              status: string;
            }
          | undefined;
        if (!cur) return { ok: false, error: 'not_found' };

        const base = Math.max(0, Math.floor(payload.baseAmount ?? cur.base_amount));
        const discount = Math.max(0, Math.floor(payload.discount ?? cur.discount));
        const adjustment = Math.floor(payload.adjustment ?? cur.adjustment);
        const total = Math.max(0, base - discount + adjustment);

        // Status auto-derivation if not explicitly set
        let status = payload.status ?? cur.status;
        if (!payload.status) {
          if (cur.paid_amount >= total && total > 0) status = 'paid';
          else if (cur.paid_amount > 0 && cur.paid_amount < total) status = 'partial';
          else status = 'unpaid';
        }

        db.prepare(
          `UPDATE tuition_invoices
              SET base_amount = ?, discount = ?, adjustment = ?,
                  total_amount = ?, due_date = COALESCE(?, due_date),
                  memo = COALESCE(?, memo), status = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(base, discount, adjustment, total, payload.dueDate ?? null, payload.memo ?? null, status, payload.id);

        logActivity(db, payload.actorId, 'tuition.updateInvoice', `invoice:${payload.id}`, {
          base,
          discount,
          adjustment,
          status,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle(
    'tuition:recordPayment',
    (
      _e,
      payload: {
        invoiceId: number;
        amount: number;
        method: 'cash' | 'card' | 'transfer' | 'other';
        paidAt?: string;
        receiptNo?: string;
        note?: string;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const result = db.transaction(() => {
          const inv = db
            .prepare(
              `SELECT id, total_amount, paid_amount, status FROM tuition_invoices WHERE id = ?`,
            )
            .get(payload.invoiceId) as
            | { id: number; total_amount: number; paid_amount: number; status: string }
            | undefined;
          if (!inv) throw new Error('invoice_not_found');

          const amt = Math.floor(payload.amount);
          db.prepare(
            `INSERT INTO tuition_payments (invoice_id, amount, method, paid_at, receipt_no, note, actor_id)
             VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)`,
          ).run(
            payload.invoiceId,
            amt,
            payload.method,
            payload.paidAt ?? null,
            payload.receiptNo ?? null,
            payload.note ?? null,
            payload.actorId,
          );

          const newPaid = inv.paid_amount + amt;
          let newStatus = inv.status;
          if (newPaid <= 0) newStatus = 'unpaid';
          else if (newPaid < inv.total_amount) newStatus = 'partial';
          else newStatus = 'paid';

          db.prepare(
            `UPDATE tuition_invoices
                SET paid_amount = ?, status = ?, updated_at = datetime('now')
              WHERE id = ?`,
          ).run(newPaid, newStatus, payload.invoiceId);

          return { newPaid, newStatus };
        })();

        logActivity(db, payload.actorId, 'tuition.recordPayment', `invoice:${payload.invoiceId}`, {
          amount: payload.amount,
          method: payload.method,
          newStatus: result.newStatus,
        });
        return { ok: true, paidAmount: result.newPaid, status: result.newStatus };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'record_failed' };
      }
    },
  );

  ipcMain.handle('tuition:listPayments', (_e, invoiceId: number) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.id, p.invoice_id, p.amount, p.method, p.paid_at, p.receipt_no,
                p.note, p.actor_id, u.name AS actor_name
           FROM tuition_payments p
           LEFT JOIN users u ON u.id = p.actor_id
          WHERE p.invoice_id = ?
          ORDER BY p.paid_at DESC`,
      )
      .all(invoiceId);
    return rows;
  });

  ipcMain.handle('tuition:periodSummary', (_e, period: string) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
            COUNT(*)                         AS invoice_count,
            COALESCE(SUM(total_amount), 0)   AS total_billed,
            COALESCE(SUM(paid_amount), 0)    AS total_paid,
            COALESCE(SUM(CASE WHEN status IN ('unpaid','partial') THEN total_amount - paid_amount ELSE 0 END), 0) AS total_outstanding,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count,
            COALESCE(SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END), 0) AS partial_count,
            COALESCE(SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END), 0) AS unpaid_count,
            COALESCE(SUM(CASE WHEN status = 'waived' THEN 1 ELSE 0 END), 0) AS waived_count
           FROM tuition_invoices
          WHERE period_yyyymm = ?`,
      )
      .get(period);
    return row ?? null;
  });

  // -------------------------------------------------------------------------
  // Payroll
  // -------------------------------------------------------------------------

  ipcMain.handle('payroll:listProfiles', () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT u.id AS user_id, u.name, u.email, u.role, u.department_id, u.active,
                d.name AS department_name,
                COALESCE(p.employment_type, 'regular') AS employment_type,
                COALESCE(p.base_salary, 0) AS base_salary,
                COALESCE(p.position_allowance, 0) AS position_allowance,
                COALESCE(p.meal_allowance, 0) AS meal_allowance,
                COALESCE(p.transport_allowance, 0) AS transport_allowance,
                COALESCE(p.other_allowance, 0) AS other_allowance,
                COALESCE(p.dependents_count, 1) AS dependents_count,
                COALESCE(p.kids_under_20, 0) AS kids_under_20,
                p.bank_name, p.bank_account, p.updated_at
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN employee_payroll_profiles p ON p.user_id = u.id
          WHERE u.active = 1
          ORDER BY d.name ASC, u.name ASC`,
      )
      .all();
    return rows;
  });

  ipcMain.handle('payroll:getProfile', (_e, userId: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT u.id AS user_id, u.name,
                COALESCE(p.employment_type, 'regular') AS employment_type,
                COALESCE(p.base_salary, 0) AS base_salary,
                COALESCE(p.position_allowance, 0) AS position_allowance,
                COALESCE(p.meal_allowance, 0) AS meal_allowance,
                COALESCE(p.transport_allowance, 0) AS transport_allowance,
                COALESCE(p.other_allowance, 0) AS other_allowance,
                COALESCE(p.dependents_count, 1) AS dependents_count,
                COALESCE(p.kids_under_20, 0) AS kids_under_20,
                p.bank_name, p.bank_account, p.updated_at
           FROM users u
           LEFT JOIN employee_payroll_profiles p ON p.user_id = u.id
          WHERE u.id = ?`,
      )
      .get(userId);
    return row ?? null;
  });

  ipcMain.handle(
    'payroll:upsertProfile',
    (
      _e,
      payload: {
        userId: number;
        employmentType: 'regular' | 'freelancer' | 'parttime';
        baseSalary: number;
        positionAllowance: number;
        mealAllowance: number;
        transportAllowance: number;
        otherAllowance: number;
        dependentsCount: number;
        kidsUnder20: number;
        bankName?: string | null;
        bankAccount?: string | null;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        db.prepare(
          `INSERT INTO employee_payroll_profiles (
             user_id, employment_type, base_salary, position_allowance, meal_allowance,
             transport_allowance, other_allowance, dependents_count, kids_under_20,
             bank_name, bank_account, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET
             employment_type = excluded.employment_type,
             base_salary = excluded.base_salary,
             position_allowance = excluded.position_allowance,
             meal_allowance = excluded.meal_allowance,
             transport_allowance = excluded.transport_allowance,
             other_allowance = excluded.other_allowance,
             dependents_count = excluded.dependents_count,
             kids_under_20 = excluded.kids_under_20,
             bank_name = excluded.bank_name,
             bank_account = excluded.bank_account,
             updated_at = datetime('now')`,
        ).run(
          payload.userId,
          payload.employmentType,
          Math.max(0, Math.floor(payload.baseSalary)),
          Math.max(0, Math.floor(payload.positionAllowance)),
          Math.max(0, Math.floor(payload.mealAllowance)),
          Math.max(0, Math.floor(payload.transportAllowance)),
          Math.max(0, Math.floor(payload.otherAllowance)),
          Math.max(1, Math.floor(payload.dependentsCount)),
          Math.max(0, Math.floor(payload.kidsUnder20)),
          payload.bankName ?? null,
          payload.bankAccount ?? null,
        );
        logActivity(db, payload.actorId, 'payroll.upsertProfile', `user:${payload.userId}`, {
          employmentType: payload.employmentType,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle('payroll:listPeriods', () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.id, p.period_yyyymm, p.pay_date, p.status, p.note,
                p.closed_by, uc.name AS closed_by_name, p.closed_at, p.paid_at,
                p.created_by, u.name AS created_by_name, p.created_at,
                (SELECT COUNT(*) FROM payslips s WHERE s.period_id = p.id) AS payslip_count,
                (SELECT COALESCE(SUM(net_pay), 0) FROM payslips s WHERE s.period_id = p.id) AS total_net_pay
           FROM payroll_periods p
           LEFT JOIN users u  ON u.id = p.created_by
           LEFT JOIN users uc ON uc.id = p.closed_by
          ORDER BY p.period_yyyymm DESC
          LIMIT 60`,
      )
      .all();
    return rows;
  });

  ipcMain.handle(
    'payroll:ensurePeriod',
    (_e, payload: { period: string; payDate?: string | null; actorId: number }) => {
      const db = getDb();
      try {
        const existing = db
          .prepare(`SELECT id FROM payroll_periods WHERE period_yyyymm = ?`)
          .get(payload.period) as { id: number } | undefined;
        if (existing) return { ok: true, id: existing.id, created: false };
        const res = db
          .prepare(
            `INSERT INTO payroll_periods (period_yyyymm, pay_date, status, created_by)
             VALUES (?, ?, 'draft', ?)`,
          )
          .run(payload.period, payload.payDate ?? null, payload.actorId);
        logActivity(db, payload.actorId, 'payroll.ensurePeriod', `period:${payload.period}`, {});
        return { ok: true, id: Number(res.lastInsertRowid), created: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'ensure_failed' };
      }
    },
  );

  ipcMain.handle(
    'payroll:generatePayslips',
    (_e, payload: { periodId: number; overwriteDraft?: boolean; actorId: number }) => {
      const db = getDb();
      try {
        const period = db
          .prepare(`SELECT id, period_yyyymm, status FROM payroll_periods WHERE id = ?`)
          .get(payload.periodId) as
          | { id: number; period_yyyymm: string; status: string }
          | undefined;
        if (!period) return { ok: false, error: 'period_not_found' };
        if (period.status !== 'draft') return { ok: false, error: 'period_locked' };

        const profiles = db
          .prepare(
            `SELECT p.user_id, p.employment_type, p.base_salary, p.position_allowance,
                    p.meal_allowance, p.transport_allowance, p.other_allowance,
                    p.dependents_count, u.name AS user_name
               FROM employee_payroll_profiles p
               JOIN users u ON u.id = p.user_id
              WHERE u.active = 1`,
          )
          .all() as {
          user_id: number;
          employment_type: 'regular' | 'freelancer' | 'parttime';
          base_salary: number;
          position_allowance: number;
          meal_allowance: number;
          transport_allowance: number;
          other_allowance: number;
          dependents_count: number;
          user_name: string;
        }[];

        let created = 0;
        let skipped = 0;
        let updated = 0;

        const existsStmt = db.prepare(
          `SELECT id, status FROM payslips WHERE period_id = ? AND user_id = ?`,
        );
        const insertStmt = db.prepare(
          `INSERT INTO payslips (
             period_id, user_id, employment_type,
             base_salary, overtime_pay, position_allowance, meal_allowance, transport_allowance,
             bonus, other_taxable, other_nontaxable, gross_pay, taxable_base,
             income_tax, local_income_tax, national_pension, health_insurance, long_term_care,
             employment_insurance, freelancer_withholding, other_deduction, total_deduction, net_pay,
             status, calc_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
        );
        const updateStmt = db.prepare(
          `UPDATE payslips SET
             employment_type = ?,
             base_salary = ?, overtime_pay = ?, position_allowance = ?, meal_allowance = ?, transport_allowance = ?,
             bonus = ?, other_taxable = ?, other_nontaxable = ?, gross_pay = ?, taxable_base = ?,
             income_tax = ?, local_income_tax = ?, national_pension = ?, health_insurance = ?, long_term_care = ?,
             employment_insurance = ?, freelancer_withholding = ?, other_deduction = ?, total_deduction = ?, net_pay = ?,
             updated_at = datetime('now')
           WHERE id = ?`,
        );

        const tx = db.transaction(() => {
          for (const p of profiles) {
            const existing = existsStmt.get(payload.periodId, p.user_id) as
              | { id: number; status: string }
              | undefined;
            if (existing && existing.status !== 'draft') {
              skipped += 1;
              continue;
            }
            if (existing && !payload.overwriteDraft) {
              skipped += 1;
              continue;
            }

            if (p.employment_type === 'regular' || p.employment_type === 'parttime') {
              const profile: RegularPayrollProfile = {
                baseSalary: p.base_salary,
                positionAllowance: p.position_allowance,
                mealAllowance: p.meal_allowance,
                transportAllowance: p.transport_allowance,
                dependents: p.dependents_count,
              };
              const inputs: RegularPayrollInputs = {
                otherTaxable: p.other_allowance,
              };
              const r = calcRegularPayroll(profile, inputs);
              if (existing) {
                updateStmt.run(
                  p.employment_type,
                  r.baseSalary, r.overtimePay, r.positionAllowance, r.mealAllowance, r.transportAllowance,
                  r.bonus, r.otherTaxable, r.otherNontaxable, r.grossPay, r.taxableBase,
                  r.incomeTax, r.localIncomeTax, r.nationalPension, r.healthInsurance, r.longTermCare,
                  r.employmentInsurance, 0, r.otherDeduction, r.totalDeduction, r.netPay,
                  existing.id,
                );
                updated += 1;
              } else {
                insertStmt.run(
                  payload.periodId, p.user_id, p.employment_type,
                  r.baseSalary, r.overtimePay, r.positionAllowance, r.mealAllowance, r.transportAllowance,
                  r.bonus, r.otherTaxable, r.otherNontaxable, r.grossPay, r.taxableBase,
                  r.incomeTax, r.localIncomeTax, r.nationalPension, r.healthInsurance, r.longTermCare,
                  r.employmentInsurance, 0, 0, r.totalDeduction, r.netPay,
                );
                created += 1;
              }
            } else {
              // freelancer — gross = base_salary (treated as contract fee)
              const r = calcFreelancerPayroll(p.base_salary);
              if (existing) {
                updateStmt.run(
                  'freelancer',
                  0, 0, 0, 0, 0,
                  0, 0, 0, r.grossPay, r.grossPay,
                  r.incomeTax, r.localIncomeTax, 0, 0, 0,
                  0, r.totalWithholding, 0, r.totalWithholding, r.netPay,
                  existing.id,
                );
                updated += 1;
              } else {
                insertStmt.run(
                  payload.periodId, p.user_id, 'freelancer',
                  0, 0, 0, 0, 0,
                  0, 0, 0, r.grossPay, r.grossPay,
                  r.incomeTax, r.localIncomeTax, 0, 0, 0,
                  0, r.totalWithholding, 0, r.totalWithholding, r.netPay,
                );
                created += 1;
              }
            }
          }
        });
        tx();

        logActivity(db, payload.actorId, 'payroll.generatePayslips', `period:${period.period_yyyymm}`, {
          created,
          updated,
          skipped,
        });
        return { ok: true, created, updated, skipped };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'generate_failed' };
      }
    },
  );

  ipcMain.handle('payroll:listPayslips', (_e, periodId: number) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT s.id, s.period_id, s.user_id, s.employment_type,
                s.base_salary, s.overtime_pay, s.position_allowance, s.meal_allowance, s.transport_allowance,
                s.bonus, s.other_taxable, s.other_nontaxable, s.gross_pay, s.taxable_base,
                s.income_tax, s.local_income_tax, s.national_pension, s.health_insurance, s.long_term_care,
                s.employment_insurance, s.freelancer_withholding, s.other_deduction, s.total_deduction, s.net_pay,
                s.status, s.memo, s.calc_version, s.created_at, s.updated_at,
                u.name AS user_name, u.email, u.role, d.name AS department_name
           FROM payslips s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN departments d ON d.id = u.department_id
          WHERE s.period_id = ?
          ORDER BY d.name ASC, u.name ASC`,
      )
      .all(periodId);
    return rows;
  });

  ipcMain.handle('payroll:getMyPayslips', (_e, userId: number) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT s.id, s.period_id, s.user_id, s.employment_type,
                s.base_salary, s.overtime_pay, s.position_allowance, s.meal_allowance, s.transport_allowance,
                s.bonus, s.other_taxable, s.other_nontaxable, s.gross_pay, s.taxable_base,
                s.income_tax, s.local_income_tax, s.national_pension, s.health_insurance, s.long_term_care,
                s.employment_insurance, s.freelancer_withholding, s.other_deduction, s.total_deduction, s.net_pay,
                s.status, s.memo, s.created_at, s.updated_at,
                p.period_yyyymm, p.pay_date, p.status AS period_status
           FROM payslips s
           JOIN payroll_periods p ON p.id = s.period_id
          WHERE s.user_id = ? AND p.status IN ('closed','paid')
          ORDER BY p.period_yyyymm DESC
          LIMIT 24`,
      )
      .all(userId);
    return rows;
  });

  ipcMain.handle(
    'payroll:updatePayslip',
    (
      _e,
      payload: {
        id: number;
        patch: Partial<{
          overtimePay: number;
          bonus: number;
          otherTaxable: number;
          otherNontaxable: number;
          otherDeduction: number;
          memo: string | null;
        }>;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        const cur = db
          .prepare(
            `SELECT s.*, p.status AS period_status FROM payslips s
               JOIN payroll_periods p ON p.id = s.period_id
              WHERE s.id = ?`,
          )
          .get(payload.id) as
          | ({
              period_status: string;
              employment_type: 'regular' | 'freelancer' | 'parttime';
              base_salary: number;
              position_allowance: number;
              meal_allowance: number;
              transport_allowance: number;
              overtime_pay: number;
              bonus: number;
              other_taxable: number;
              other_nontaxable: number;
              other_deduction: number;
              status: string;
            } & Record<string, unknown>)
          | undefined;
        if (!cur) return { ok: false, error: 'not_found' };
        if (cur.period_status !== 'draft') return { ok: false, error: 'period_locked' };
        if (cur.status !== 'draft') return { ok: false, error: 'payslip_locked' };

        const nextOvertime = Math.max(0, Math.floor(payload.patch.overtimePay ?? cur.overtime_pay));
        const nextBonus = Math.max(0, Math.floor(payload.patch.bonus ?? cur.bonus));
        const nextOtherTaxable = Math.max(0, Math.floor(payload.patch.otherTaxable ?? cur.other_taxable));
        const nextOtherNontaxable = Math.max(0, Math.floor(payload.patch.otherNontaxable ?? cur.other_nontaxable));
        const nextOtherDeduction = Math.max(0, Math.floor(payload.patch.otherDeduction ?? cur.other_deduction));
        const memo = payload.patch.memo ?? null;

        if (cur.employment_type === 'freelancer') {
          // Freelancer fee can still be adjusted via overtime/bonus fields — treat as additional fee.
          const gross = cur.base_salary + nextBonus + nextOtherTaxable + nextOvertime;
          const r = calcFreelancerPayroll(gross);
          db.prepare(
            `UPDATE payslips SET
               overtime_pay = ?, bonus = ?, other_taxable = ?, other_nontaxable = ?, other_deduction = ?, memo = COALESCE(?, memo),
               gross_pay = ?, taxable_base = ?, income_tax = ?, local_income_tax = ?, freelancer_withholding = ?,
               total_deduction = ?, net_pay = ?, updated_at = datetime('now')
             WHERE id = ?`,
          ).run(
            nextOvertime, nextBonus, nextOtherTaxable, nextOtherNontaxable, nextOtherDeduction, memo,
            r.grossPay, r.grossPay, r.incomeTax, r.localIncomeTax, r.totalWithholding,
            r.totalWithholding + nextOtherDeduction, r.netPay - nextOtherDeduction,
            payload.id,
          );
        } else {
          const profile: RegularPayrollProfile = {
            baseSalary: cur.base_salary,
            positionAllowance: cur.position_allowance,
            mealAllowance: cur.meal_allowance,
            transportAllowance: cur.transport_allowance,
          };
          const inputs: RegularPayrollInputs = {
            overtimePay: nextOvertime,
            bonus: nextBonus,
            otherTaxable: nextOtherTaxable,
            otherNontaxable: nextOtherNontaxable,
            otherDeduction: nextOtherDeduction,
          };
          const r = calcRegularPayroll(profile, inputs);
          db.prepare(
            `UPDATE payslips SET
               overtime_pay = ?, bonus = ?, other_taxable = ?, other_nontaxable = ?, other_deduction = ?, memo = COALESCE(?, memo),
               gross_pay = ?, taxable_base = ?,
               income_tax = ?, local_income_tax = ?, national_pension = ?, health_insurance = ?, long_term_care = ?,
               employment_insurance = ?, total_deduction = ?, net_pay = ?, updated_at = datetime('now')
             WHERE id = ?`,
          ).run(
            nextOvertime, nextBonus, nextOtherTaxable, nextOtherNontaxable, nextOtherDeduction, memo,
            r.grossPay, r.taxableBase,
            r.incomeTax, r.localIncomeTax, r.nationalPension, r.healthInsurance, r.longTermCare,
            r.employmentInsurance, r.totalDeduction, r.netPay,
            payload.id,
          );
        }

        logActivity(db, payload.actorId, 'payroll.updatePayslip', `payslip:${payload.id}`, payload.patch);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle(
    'payroll:closePeriod',
    (_e, payload: { periodId: number; actorId: number }) => {
      const db = getDb();
      try {
        const res = db
          .prepare(
            `UPDATE payroll_periods
                SET status = 'closed', closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ? AND status = 'draft'`,
          )
          .run(payload.actorId, payload.periodId);
        if (res.changes === 0) return { ok: false, error: 'not_in_draft' };
        db.prepare(
          `UPDATE payslips SET status = 'closed', updated_at = datetime('now') WHERE period_id = ? AND status = 'draft'`,
        ).run(payload.periodId);
        logActivity(db, payload.actorId, 'payroll.closePeriod', `period:${payload.periodId}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'close_failed' };
      }
    },
  );

  ipcMain.handle(
    'payroll:markPaid',
    (_e, payload: { periodId: number; paidAt?: string; actorId: number }) => {
      const db = getDb();
      try {
        const res = db
          .prepare(
            `UPDATE payroll_periods
                SET status = 'paid', paid_at = COALESCE(?, datetime('now')), updated_at = datetime('now')
              WHERE id = ? AND status IN ('draft','closed')`,
          )
          .run(payload.paidAt ?? null, payload.periodId);
        if (res.changes === 0) return { ok: false, error: 'invalid_state' };
        db.prepare(
          `UPDATE payslips SET status = 'paid', updated_at = datetime('now') WHERE period_id = ?`,
        ).run(payload.periodId);
        logActivity(db, payload.actorId, 'payroll.markPaid', `period:${payload.periodId}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'mark_paid_failed' };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Recurring subscriptions (정기 결제)
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'subscriptions:list',
    (_e, filter?: { status?: string; cardId?: number }) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.status) {
        where.push('s.status = ?');
        params.push(filter.status);
      }
      if (typeof filter?.cardId === 'number') {
        where.push('s.card_id = ?');
        params.push(filter.cardId);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const rows = db
        .prepare(
          `SELECT s.id, s.vendor, s.plan, s.category, s.amount, s.currency, s.cadence, s.cadence_days,
                  s.next_charge_at, s.card_id, s.owner_user_id, s.status, s.started_at, s.cancelled_at, s.memo,
                  s.created_at, s.updated_at,
                  c.alias AS card_alias, c.last4 AS card_last4,
                  u.name AS owner_name
             FROM recurring_subscriptions s
             LEFT JOIN corporate_cards c ON c.id = s.card_id
             LEFT JOIN users u ON u.id = s.owner_user_id
             ${whereSql}
            ORDER BY s.status ASC, s.next_charge_at ASC, s.vendor ASC`,
        )
        .all(...params);
      return rows;
    },
  );

  ipcMain.handle(
    'subscriptions:upsert',
    (
      _e,
      payload: {
        id?: number;
        vendor: string;
        plan?: string | null;
        category?: string | null;
        amount: number;
        currency?: string;
        cadence: 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'custom';
        cadenceDays?: number | null;
        nextChargeAt?: string | null;
        cardId?: number | null;
        ownerUserId?: number | null;
        status?: 'active' | 'paused' | 'cancelled';
        startedAt?: string | null;
        memo?: string | null;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        if (!payload.vendor.trim()) return { ok: false, error: 'vendor_required' };
        if (payload.id) {
          db.prepare(
            `UPDATE recurring_subscriptions SET
               vendor = ?, plan = ?, category = ?, amount = ?, currency = COALESCE(?, currency),
               cadence = ?, cadence_days = ?, next_charge_at = ?, card_id = ?, owner_user_id = ?,
               status = COALESCE(?, status), started_at = ?, memo = ?, updated_at = datetime('now')
             WHERE id = ?`,
          ).run(
            payload.vendor.trim(),
            payload.plan ?? null,
            payload.category ?? null,
            Math.max(0, Math.floor(payload.amount)),
            payload.currency ?? null,
            payload.cadence,
            payload.cadenceDays ?? null,
            payload.nextChargeAt ?? null,
            payload.cardId ?? null,
            payload.ownerUserId ?? null,
            payload.status ?? null,
            payload.startedAt ?? null,
            payload.memo ?? null,
            payload.id,
          );
          logActivity(db, payload.actorId, 'subscriptions.update', `sub:${payload.id}`, {
            vendor: payload.vendor,
          });
          return { ok: true, id: payload.id };
        }
        const res = db
          .prepare(
            `INSERT INTO recurring_subscriptions (
               vendor, plan, category, amount, currency, cadence, cadence_days, next_charge_at,
               card_id, owner_user_id, status, started_at, memo
             ) VALUES (?, ?, ?, ?, COALESCE(?, 'KRW'), ?, ?, ?, ?, ?, COALESCE(?, 'active'), ?, ?)`,
          )
          .run(
            payload.vendor.trim(),
            payload.plan ?? null,
            payload.category ?? null,
            Math.max(0, Math.floor(payload.amount)),
            payload.currency ?? null,
            payload.cadence,
            payload.cadenceDays ?? null,
            payload.nextChargeAt ?? null,
            payload.cardId ?? null,
            payload.ownerUserId ?? null,
            payload.status ?? null,
            payload.startedAt ?? null,
            payload.memo ?? null,
          );
        const id = Number(res.lastInsertRowid);
        logActivity(db, payload.actorId, 'subscriptions.create', `sub:${id}`, {
          vendor: payload.vendor,
        });
        return { ok: true, id };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle(
    'subscriptions:setStatus',
    (
      _e,
      payload: { id: number; status: 'active' | 'paused' | 'cancelled'; actorId: number },
    ) => {
      const db = getDb();
      try {
        const cancelledAt =
          payload.status === 'cancelled' ? new Date().toISOString() : null;
        db.prepare(
          `UPDATE recurring_subscriptions
              SET status = ?,
                  cancelled_at = CASE WHEN ? = 'cancelled' THEN COALESCE(cancelled_at, datetime('now')) ELSE cancelled_at END,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(payload.status, payload.status, payload.id);
        logActivity(db, payload.actorId, 'subscriptions.setStatus', `sub:${payload.id}`, {
          status: payload.status,
          cancelledAt,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'status_failed' };
      }
    },
  );

  ipcMain.handle('subscriptions:monthlyForecast', () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT vendor, cadence, amount FROM recurring_subscriptions WHERE status = 'active'`,
      )
      .all() as { vendor: string; cadence: string; amount: number }[];
    let monthlyTotal = 0;
    for (const r of rows) {
      switch (r.cadence) {
        case 'monthly':
          monthlyTotal += r.amount;
          break;
        case 'yearly':
          monthlyTotal += Math.round(r.amount / 12);
          break;
        case 'quarterly':
          monthlyTotal += Math.round(r.amount / 3);
          break;
        case 'weekly':
          monthlyTotal += Math.round(r.amount * (52 / 12));
          break;
        default:
          monthlyTotal += r.amount; // conservative
      }
    }
    return { activeCount: rows.length, monthlyTotal };
  });

  ipcMain.handle(
    'subscriptions:delete',
    (_e, payload: { id: number; actorId: number }) => {
      const db = getDb();
      try {
        db.prepare(`DELETE FROM recurring_subscriptions WHERE id = ?`).run(payload.id);
        logActivity(db, payload.actorId, 'subscriptions.delete', `sub:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Corporate cards
  // -------------------------------------------------------------------------

  ipcMain.handle('corpCards:list', (_e, filter?: { status?: string }) => {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      where.push('c.status = ?');
      params.push(filter.status);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db
      .prepare(
        `SELECT c.id, c.alias, c.brand, c.issuer, c.last4, c.holder_user_id, c.owner_user_id,
                c.monthly_limit, c.statement_day, c.status, c.memo, c.created_at, c.updated_at,
                uh.name AS holder_name, uo.name AS owner_name,
                (SELECT COUNT(*) FROM recurring_subscriptions s WHERE s.card_id = c.id AND s.status = 'active') AS active_sub_count,
                (SELECT COALESCE(SUM(amount), 0)
                   FROM corporate_card_transactions t
                  WHERE t.card_id = c.id
                    AND strftime('%Y-%m', t.spent_at) = strftime('%Y-%m', 'now')) AS mtd_spend
           FROM corporate_cards c
           LEFT JOIN users uh ON uh.id = c.holder_user_id
           LEFT JOIN users uo ON uo.id = c.owner_user_id
           ${whereSql}
          ORDER BY c.status ASC, c.alias ASC`,
      )
      .all(...params);
    return rows;
  });

  ipcMain.handle(
    'corpCards:upsert',
    (
      _e,
      payload: {
        id?: number;
        alias: string;
        brand?: string | null;
        issuer?: string | null;
        last4: string;
        holderUserId?: number | null;
        ownerUserId?: number | null;
        monthlyLimit: number;
        statementDay: number;
        status?: 'active' | 'frozen' | 'retired';
        memo?: string | null;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        if (!/^\d{4}$/.test(payload.last4)) return { ok: false, error: 'last4_format' };
        if (!payload.alias.trim()) return { ok: false, error: 'alias_required' };
        const limit = Math.max(0, Math.floor(payload.monthlyLimit));
        const statementDay = Math.min(28, Math.max(1, Math.floor(payload.statementDay || 1)));
        if (payload.id) {
          db.prepare(
            `UPDATE corporate_cards SET
               alias = ?, brand = ?, issuer = ?, last4 = ?, holder_user_id = ?, owner_user_id = ?,
               monthly_limit = ?, statement_day = ?, status = COALESCE(?, status), memo = ?,
               updated_at = datetime('now')
             WHERE id = ?`,
          ).run(
            payload.alias.trim(),
            payload.brand ?? null,
            payload.issuer ?? null,
            payload.last4,
            payload.holderUserId ?? null,
            payload.ownerUserId ?? null,
            limit,
            statementDay,
            payload.status ?? null,
            payload.memo ?? null,
            payload.id,
          );
          logActivity(db, payload.actorId, 'corpCards.update', `card:${payload.id}`, {});
          return { ok: true, id: payload.id };
        }
        const res = db
          .prepare(
            `INSERT INTO corporate_cards (
               alias, brand, issuer, last4, holder_user_id, owner_user_id,
               monthly_limit, statement_day, status, memo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'active'), ?)`,
          )
          .run(
            payload.alias.trim(),
            payload.brand ?? null,
            payload.issuer ?? null,
            payload.last4,
            payload.holderUserId ?? null,
            payload.ownerUserId ?? null,
            limit,
            statementDay,
            payload.status ?? null,
            payload.memo ?? null,
          );
        const id = Number(res.lastInsertRowid);
        logActivity(db, payload.actorId, 'corpCards.create', `card:${id}`, {});
        return { ok: true, id };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle(
    'corpCards:setStatus',
    (
      _e,
      payload: { id: number; status: 'active' | 'frozen' | 'retired'; actorId: number },
    ) => {
      const db = getDb();
      try {
        db.prepare(
          `UPDATE corporate_cards SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(payload.status, payload.id);
        logActivity(db, payload.actorId, 'corpCards.setStatus', `card:${payload.id}`, {
          status: payload.status,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'status_failed' };
      }
    },
  );

  ipcMain.handle(
    'corpCards:listTransactions',
    (
      _e,
      filter?: { cardId?: number; period?: string; reconciled?: boolean; limit?: number },
    ) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (typeof filter?.cardId === 'number') {
        where.push('t.card_id = ?');
        params.push(filter.cardId);
      }
      if (filter?.period) {
        where.push("strftime('%Y-%m', t.spent_at) = ?");
        params.push(filter.period);
      }
      if (typeof filter?.reconciled === 'boolean') {
        where.push('t.reconciled = ?');
        params.push(filter.reconciled ? 1 : 0);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const limit = Math.min(1000, Math.max(1, filter?.limit ?? 200));
      const rows = db
        .prepare(
          `SELECT t.id, t.card_id, t.spent_at, t.merchant, t.category, t.amount, t.currency,
                  t.note, t.subscription_id, t.receipt_path, t.reconciled, t.actor_id, t.created_at,
                  c.alias AS card_alias, c.last4 AS card_last4,
                  s.vendor AS subscription_vendor,
                  u.name  AS actor_name
             FROM corporate_card_transactions t
             LEFT JOIN corporate_cards c ON c.id = t.card_id
             LEFT JOIN recurring_subscriptions s ON s.id = t.subscription_id
             LEFT JOIN users u ON u.id = t.actor_id
             ${whereSql}
            ORDER BY t.spent_at DESC, t.id DESC
            LIMIT ${limit}`,
        )
        .all(...params);
      return rows;
    },
  );

  ipcMain.handle(
    'corpCards:addTransaction',
    (
      _e,
      payload: {
        cardId: number;
        spentAt: string;
        merchant: string;
        category?: string | null;
        amount: number;
        currency?: string;
        note?: string | null;
        subscriptionId?: number | null;
        receiptPath?: string | null;
        actorId: number;
      },
    ) => {
      const db = getDb();
      try {
        if (!payload.merchant.trim()) return { ok: false, error: 'merchant_required' };
        const res = db
          .prepare(
            `INSERT INTO corporate_card_transactions (
               card_id, spent_at, merchant, category, amount, currency, note,
               subscription_id, receipt_path, reconciled, actor_id
             ) VALUES (?, ?, ?, ?, ?, COALESCE(?, 'KRW'), ?, ?, ?, 0, ?)`,
          )
          .run(
            payload.cardId,
            payload.spentAt,
            payload.merchant.trim(),
            payload.category ?? null,
            Math.floor(payload.amount),
            payload.currency ?? null,
            payload.note ?? null,
            payload.subscriptionId ?? null,
            payload.receiptPath ?? null,
            payload.actorId,
          );
        const id = Number(res.lastInsertRowid);
        logActivity(db, payload.actorId, 'corpCards.addTransaction', `tx:${id}`, {
          cardId: payload.cardId,
          amount: payload.amount,
        });
        return { ok: true, id };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'add_failed' };
      }
    },
  );

  ipcMain.handle(
    'corpCards:setReconciled',
    (_e, payload: { id: number; reconciled: boolean; actorId: number }) => {
      const db = getDb();
      try {
        db.prepare(
          `UPDATE corporate_card_transactions SET reconciled = ? WHERE id = ?`,
        ).run(payload.reconciled ? 1 : 0, payload.id);
        logActivity(db, payload.actorId, 'corpCards.setReconciled', `tx:${payload.id}`, {
          reconciled: payload.reconciled,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'reconcile_failed' };
      }
    },
  );

  ipcMain.handle(
    'corpCards:deleteTransaction',
    (_e, payload: { id: number; actorId: number }) => {
      const db = getDb();
      try {
        db.prepare(`DELETE FROM corporate_card_transactions WHERE id = ?`).run(payload.id);
        logActivity(db, payload.actorId, 'corpCards.deleteTransaction', `tx:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  ipcMain.handle('corpCards:monthlySummary', (_e, period: string) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.id AS card_id, c.alias, c.last4, c.monthly_limit,
                COALESCE(SUM(t.amount), 0) AS total_spend,
                COUNT(t.id) AS tx_count,
                COALESCE(SUM(CASE WHEN t.reconciled = 0 THEN 1 ELSE 0 END), 0) AS unreconciled_count
           FROM corporate_cards c
           LEFT JOIN corporate_card_transactions t
             ON t.card_id = c.id AND strftime('%Y-%m', t.spent_at) = ?
          GROUP BY c.id
          ORDER BY c.alias ASC`,
      )
      .all(period);
    return rows;
  });
}

// ===========================================================================
// Student information archive (학생 정보 보관함)
//  - list / get students + full activity history (assignments + parsing_results)
//  - report topics CRUD
//  - archive files CRUD (metadata only — file bytes live elsewhere for now)
// ===========================================================================
function registerStudentArchiveIpc() {
  // ---- students listing --------------------------------------------------
  ipcMain.handle(
    'students:list',
    (_e, filter?: { q?: string; limit?: number }) => {
      const db = getDb();
      const where: string[] = ['s.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter?.q && filter.q.trim()) {
        where.push('(s.name LIKE ? OR s.student_code LIKE ? OR s.school LIKE ? OR s.guardian LIKE ?)');
        const like = `%${filter.q.trim()}%`;
        params.push(like, like, like, like);
      }
      const lim = Math.min(Math.max(filter?.limit ?? 500, 1), 2000);
      return db
        .prepare(
          `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.guardian, s.memo,
                  s.created_at,
                  (SELECT COUNT(*) FROM assignments a WHERE a.student_id = s.id) AS assignment_count,
                  (SELECT COUNT(*) FROM student_report_topics t WHERE t.student_id = s.id) AS topic_count,
                  (SELECT COUNT(*) FROM student_archive_files f WHERE f.student_id = s.id) AS file_count
             FROM students s
            WHERE ${where.join(' AND ')}
            ORDER BY s.name ASC, s.student_code ASC
            LIMIT ${lim}`,
        )
        .all(...params);
    },
  );

  ipcMain.handle('students:get', (_e, studentId: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.guardian, s.memo,
                s.monthly_fee, s.billing_day, s.billing_active, s.created_at
           FROM students s
          WHERE s.id = ? AND s.deleted_at IS NULL`,
      )
      .get(studentId);
    return row ?? null;
  });

  // ---- combined history: assignments + parsing_results ------------------
  ipcMain.handle('students:history', (_e, studentId: number) => {
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
  ipcMain.handle('students:getParsingDetail', (_e, parsingId: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT p.id, p.assignment_id, p.version, p.content_json, p.ai_summary,
                p.confidence, p.parsed_at, p.parsed_by,
                u.name AS parser_name,
                a.code AS assignment_code,
                a.title AS assignment_title,
                a.subject AS assignment_subject,
                a.publisher AS assignment_publisher
           FROM parsing_results p
           JOIN assignments a ON a.id = p.assignment_id
           LEFT JOIN users u ON u.id = p.parsed_by
          WHERE p.id = ?`,
      )
      .get(parsingId);
    return row ?? null;
  });

  // ---- report topics -----------------------------------------------------
  ipcMain.handle('students:listReportTopics', (_e, studentId: number) => {
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
      _e,
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
        actorId: number;
      },
    ) => {
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
          logActivity(db, payload.actorId, 'students.updateReportTopic', `topic:${payload.id}`, {
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
            payload.actorId,
          );
        logActivity(
          db,
          payload.actorId,
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
    (_e, payload: { id: number; actorId: number }) => {
      const db = getDb();
      try {
        const res = db
          .prepare(`DELETE FROM student_report_topics WHERE id = ?`)
          .run(payload.id);
        logActivity(db, payload.actorId, 'students.deleteReportTopic', `topic:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  // ---- archive files -----------------------------------------------------
  ipcMain.handle(
    'students:listArchiveFiles',
    (_e, filter: { studentId: number; topicId?: number | null }) => {
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
      _e,
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
            payload.uploaderId,
          );
        logActivity(
          db,
          payload.uploaderId,
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
    (_e, payload: { id: number; actorId: number }) => {
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
        const res = db
          .prepare(`DELETE FROM student_archive_files WHERE id = ?`)
          .run(payload.id);
        logActivity(db, payload.actorId, 'students.deleteArchiveFile', `archiveFile:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );
}

/**
 * Small helper — append an activity log row. Any error swallowed (logs must
 * never block the caller).
 */
function logActivity(
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
function syncAssignmentArchive(
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
