import { ipcMain } from 'electron';
import { getDb } from '../../db';
import { requireRole, ROLE_SETS } from '../../auth';
import type { AdminIpcDeps } from '../admin';

export function registerSubscriptionsIpc({ logActivity, recordDeletion }: AdminIpcDeps) {
  // -------------------------------------------------------------------------
  // Recurring subscriptions (정기 결제)
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'subscriptions:list',
    (event, filter?: { status?: string; cardId?: number }) => {
      // 정기결제 목록은 임원(CEO/CTO)만 — 법인카드·금액 노출.
      requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
      event,
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
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
          logActivity(db, actor.userId, 'subscriptions.update', `sub:${payload.id}`, {
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
        logActivity(db, actor.userId, 'subscriptions.create', `sub:${id}`, {
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
      event,
      payload: { id: number; status: 'active' | 'paused' | 'cancelled'; actorId?: number },
    ) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
        logActivity(db, actor.userId, 'subscriptions.setStatus', `sub:${payload.id}`, {
          status: payload.status,
          cancelledAt,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'status_failed' };
      }
    },
  );

  ipcMain.handle('subscriptions:monthlyForecast', (event) => {
    // 월 정기결제 합계 — 임원만.
    requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
      const db = getDb();
      try {
        recordDeletion(db, 'recurring_subscriptions', payload.id, actor.userId, {
          reason: payload.reason,
        });
        db.prepare(`DELETE FROM recurring_subscriptions WHERE id = ?`).run(payload.id);
        logActivity(db, actor.userId, 'subscriptions.delete', `sub:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );


}
