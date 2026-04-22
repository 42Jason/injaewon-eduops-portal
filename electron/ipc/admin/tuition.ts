import { ipcMain } from 'electron';
import { getDb } from '../../db';
import { requireRole, ROLE_SETS } from '../../auth';
import type { AdminIpcDeps } from '../admin';

export function registerTuitionIpc({
  logActivity,
  dismissEntityNotifications,
}: AdminIpcDeps) {
  // -------------------------------------------------------------------------
  // Tuition billing
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'tuition:listStudents',
    (event, filter?: { active?: boolean; search?: string }) => {
      requireRole(event, ROLE_SETS.financeReader);
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
      event,
      payload: {
        studentId: number;
        monthlyFee?: number;
        billingDay?: number;
        billingActive?: boolean;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.financeReader);
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
        logActivity(db, actor.userId, 'tuition.updateStudentBilling', `student:${payload.studentId}`, {
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
    (event, filter?: { period?: string; status?: string; studentId?: number }) => {
      requireRole(event, ROLE_SETS.financeReader);
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
      event,
      payload: { period: string; dueDate?: string; actorId?: number; overwrite?: boolean },
    ) => {
      const actor = requireRole(event, ROLE_SETS.financeReader);
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
              actor.userId,
            );
            created += 1;
          }
        });
        tx();

        logActivity(db, actor.userId, 'tuition.generateMonthly', `period:${payload.period}`, {
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
      event,
      payload: {
        id: number;
        baseAmount?: number;
        discount?: number;
        adjustment?: number;
        dueDate?: string | null;
        memo?: string | null;
        status?: 'unpaid' | 'partial' | 'paid' | 'waived' | 'cancelled';
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.financeReader);
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

        logActivity(db, actor.userId, 'tuition.updateInvoice', `invoice:${payload.id}`, {
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
      event,
      payload: {
        invoiceId: number;
        amount: number;
        method: 'cash' | 'card' | 'transfer' | 'other';
        paidAt?: string;
        receiptNo?: string;
        note?: string;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.financeReader);
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
            actor.userId,
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

        logActivity(db, actor.userId, 'tuition.recordPayment', `invoice:${payload.invoiceId}`, {
          amount: payload.amount,
          method: payload.method,
          newStatus: result.newStatus,
        });
        // 완납이 되면 이 인보이스에 붙은 미처리 연체 알림들을 dismiss.
        if (result.newStatus === 'paid') {
          dismissEntityNotifications(db, 'tuition_invoices', payload.invoiceId);
        }
        return { ok: true, paidAmount: result.newPaid, status: result.newStatus };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'record_failed' };
      }
    },
  );

  ipcMain.handle('tuition:listPayments', (event, invoiceId: number) => {
    // 납부 내역 — 운영 관리자 이상만.
    requireRole(event, ROLE_SETS.financeReader);
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

  ipcMain.handle('tuition:periodSummary', (event, period: string) => {
    // 학원비 기간 집계 — 운영 관리자 이상만.
    requireRole(event, ROLE_SETS.financeReader);
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


}
