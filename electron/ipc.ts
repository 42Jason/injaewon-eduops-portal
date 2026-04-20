import { ipcMain } from 'electron';
import { getDb, getDbPath } from './db';
import { login } from './auth';
import { parseInstructionExcel, type ParsedRow } from './parseExcel';

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
      const res = db
        .prepare(
          `UPDATE assignments
              SET state = ?,
                  updated_at = ?,
                  completed_at = CASE WHEN ? IN ('완료','승인완료') THEN ? ELSE completed_at END
            WHERE id = ?`,
        )
        .run(payload.state, now, payload.state, now, payload.id);
      return { ok: res.changes > 0 };
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
