import { ipcMain } from 'electron';
import { getDb } from '../../db';
import { requireActor, requireRole, ROLE_SETS, AuthError } from '../../auth';
import {
  calcRegularPayroll,
  calcFreelancerPayroll,
  type RegularPayrollProfile,
  type RegularPayrollInputs,
} from '../../payroll-calc';
import type { AdminIpcDeps } from '../admin';

export function registerPayrollIpc({ logActivity }: AdminIpcDeps) {
  // -------------------------------------------------------------------------
  // Payroll
  // -------------------------------------------------------------------------

  ipcMain.handle('payroll:listProfiles', (event) => {
    // 급여 프로필 전수 조회 — 기본급·계좌번호까지 노출되므로 HR 관리자 이상만.
    requireRole(event, ROLE_SETS.hrAdmin);
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

  ipcMain.handle('payroll:getProfile', (event, userId: number) => {
    // 본인 프로필은 본인 또는 HR 관리자 이상만.
    const actor = requireActor(event);
    if (actor.userId !== userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
      throw new AuthError('forbidden', '본인의 급여 프로필만 조회할 수 있습니다.');
    }
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
      event,
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
        actorId?: number;
      },
    ) => {
      // 급여 프로필 작성은 HR 관리자·임원만.
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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
        logActivity(db, actor.userId, 'payroll.upsertProfile', `user:${payload.userId}`, {
          employmentType: payload.employmentType,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle('payroll:listPeriods', (event) => {
    // 급여 기간 목록(총지급액 집계 포함) — HR 관리자 이상만.
    requireRole(event, ROLE_SETS.hrAdmin);
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
    (event, payload: { period: string; payDate?: string | null; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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
          .run(payload.period, payload.payDate ?? null, actor.userId);
        logActivity(db, actor.userId, 'payroll.ensurePeriod', `period:${payload.period}`, {});
        return { ok: true, id: Number(res.lastInsertRowid), created: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'ensure_failed' };
      }
    },
  );

  ipcMain.handle(
    'payroll:generatePayslips',
    (event, payload: { periodId: number; overwriteDraft?: boolean; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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

        logActivity(db, actor.userId, 'payroll.generatePayslips', `period:${period.period_yyyymm}`, {
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

  ipcMain.handle('payroll:listPayslips', (event, periodId: number) => {
    // 전체 급여명세 목록은 HR 관리자 이상만.
    requireRole(event, ROLE_SETS.hrAdmin);
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

  ipcMain.handle('payroll:getMyPayslips', (event, userId: number) => {
    // 본인 급여명세 또는 HR 관리자 이상만. 타인 userId 위조 차단.
    const actor = requireActor(event);
    if (actor.userId !== userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
      throw new AuthError('forbidden', '본인의 급여명세만 조회할 수 있습니다.');
    }
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
      event,
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
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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

        logActivity(db, actor.userId, 'payroll.updatePayslip', `payslip:${payload.id}`, payload.patch);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle(
    'payroll:closePeriod',
    (event, payload: { periodId: number; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
      const db = getDb();
      try {
        const res = db
          .prepare(
            `UPDATE payroll_periods
                SET status = 'closed', closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ? AND status = 'draft'`,
          )
          .run(actor.userId, payload.periodId);
        if (res.changes === 0) return { ok: false, error: 'not_in_draft' };
        db.prepare(
          `UPDATE payslips SET status = 'closed', updated_at = datetime('now') WHERE period_id = ? AND status = 'draft'`,
        ).run(payload.periodId);
        logActivity(db, actor.userId, 'payroll.closePeriod', `period:${payload.periodId}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'close_failed' };
      }
    },
  );

  ipcMain.handle(
    'payroll:markPaid',
    (event, payload: { periodId: number; paidAt?: string; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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
        logActivity(db, actor.userId, 'payroll.markPaid', `period:${payload.periodId}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'mark_paid_failed' };
      }
    },
  );


}
