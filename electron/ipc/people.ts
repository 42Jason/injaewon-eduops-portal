import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireActor, requireRole, ROLE_SETS, AuthError } from '../auth';

export function registerPeopleIpc() {
  // -- attendance -------------------------------------------------------------
  /**
   * Return today's attendance row for a user (or null if not checked in yet).
   */
  ipcMain.handle('attendance:today', (event, userId: number) => {
    // 본인 오늘자 근태만, HR/리더십은 모두 조회 가능.
    const actor = requireActor(event);
    if (actor.userId !== userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
      throw new AuthError('forbidden', '본인의 근태 정보만 조회할 수 있습니다.');
    }
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
  ipcMain.handle('attendance:checkIn', (event, payload: { userId: number; note?: string }) => {
    // 본인만 출근 체크 — HR 관리자도 대신 체크 가능.
    const actor = requireActor(event);
    if (actor.userId !== payload.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
      throw new AuthError('forbidden', '본인만 출근 체크할 수 있습니다.');
    }
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
    (event, payload: { userId: number; breakMin?: number; note?: string }) => {
      // 본인만 퇴근 체크 — HR 관리자도 대신 체크 가능.
      const actor = requireActor(event);
      if (actor.userId !== payload.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
        throw new AuthError('forbidden', '본인만 퇴근 체크할 수 있습니다.');
      }
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
    (event, payload: { userId: number; yyyymm: string }) => {
      // 본인 근태 or HR 관리자 이상만.
      const actor = requireActor(event);
      if (actor.userId !== payload.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
        throw new AuthError('forbidden', '본인의 근태 이력만 조회할 수 있습니다.');
      }
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
    (event, payload: { userId: number; yyyymm: string }) => {
      // 본인 근태 요약 or HR 관리자 이상만.
      const actor = requireActor(event);
      if (actor.userId !== payload.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
        throw new AuthError('forbidden', '본인의 근태 요약만 조회할 수 있습니다.');
      }
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
    (event, filter?: { userId?: number; status?: string }) => {
      // 본인 기록만이면 세션 유저 == filter.userId 여야 함.
      // 그 외(전체 목록, 타인 조회)는 HR 관리자 이상만.
      const actor = requireActor(event);
      const isSelfOnly = typeof filter?.userId === 'number' && filter.userId === actor.userId;
      if (!isSelfOnly && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
        throw new AuthError('forbidden', '본인의 휴가 기록만 조회할 수 있습니다.');
      }
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
  ipcMain.handle('leave:balance', (event, userId: number) => {
    // 본인 연차 잔여일수 또는 HR 관리자 이상만.
    const actor = requireActor(event);
    if (actor.userId !== userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
      throw new AuthError('forbidden', '본인의 연차 잔여일수만 조회할 수 있습니다.');
    }
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
      event,
      payload: {
        userId: number;
        kind: 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special' | 'unpaid';
        startDate: string;
        endDate: string;
        reason?: string;
      },
    ) => {
      // 본인만 휴가 신청 가능. HR 관리자는 대리 신청 가능.
      const actor = requireActor(event);
      if (actor.userId !== payload.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
        throw new AuthError('forbidden', '본인의 휴가만 신청할 수 있습니다.');
      }
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
      event,
      payload: {
        id: number;
        approverId?: number;
        decision: 'approved' | 'rejected';
        comment?: string;
      },
    ) => {
      // 결재는 HR 관리자 이상만.
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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
            actor.userId,
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
    (event, payload: { id: number; userId?: number }) => {
      // 본인 휴가만 취소 가능. HR 관리자는 대신 취소 가능.
      const actor = requireActor(event);
      const targetUserId = payload.userId ?? actor.userId;
      if (targetUserId !== actor.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
        throw new AuthError('forbidden', '본인의 휴가만 취소할 수 있습니다.');
      }
      const db = getDb();
      const res = db
        .prepare(
          `UPDATE leave_requests
              SET status = 'cancelled', decided_at = datetime('now')
            WHERE id = ? AND user_id = ? AND status = 'pending'`,
        )
        .run(payload.id, targetUserId);
      return { ok: res.changes > 0 };
    },
  );


}
