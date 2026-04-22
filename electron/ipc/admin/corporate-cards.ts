import { ipcMain } from 'electron';
import { getDb } from '../../db';
import { requireRole, ROLE_SETS } from '../../auth';
import type { AdminIpcDeps } from '../admin';

export function registerCorporateCardsIpc({ logActivity, recordDeletion }: AdminIpcDeps) {
  // -------------------------------------------------------------------------
  // Corporate cards
  // -------------------------------------------------------------------------

  ipcMain.handle('corpCards:list', (event, filter?: { status?: string }) => {
    // 법인카드 목록 — 임원만.
    requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
      event,
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
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
          logActivity(db, actor.userId, 'corpCards.update', `card:${payload.id}`, {});
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
        logActivity(db, actor.userId, 'corpCards.create', `card:${id}`, {});
        return { ok: true, id };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle(
    'corpCards:setStatus',
    (
      event,
      payload: { id: number; status: 'active' | 'frozen' | 'retired'; actorId?: number },
    ) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
      const db = getDb();
      try {
        db.prepare(
          `UPDATE corporate_cards SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(payload.status, payload.id);
        logActivity(db, actor.userId, 'corpCards.setStatus', `card:${payload.id}`, {
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
      event,
      filter?: { cardId?: number; period?: string; reconciled?: boolean; limit?: number },
    ) => {
      // 법인카드 트랜잭션 — 임원만.
      requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
      event,
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
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
            actor.userId,
          );
        const id = Number(res.lastInsertRowid);
        logActivity(db, actor.userId, 'corpCards.addTransaction', `tx:${id}`, {
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
    (event, payload: { id: number; reconciled: boolean; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
      const db = getDb();
      try {
        db.prepare(
          `UPDATE corporate_card_transactions SET reconciled = ? WHERE id = ?`,
        ).run(payload.reconciled ? 1 : 0, payload.id);
        logActivity(db, actor.userId, 'corpCards.setReconciled', `tx:${payload.id}`, {
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
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.subscriptionCardAdmin);
      const db = getDb();
      try {
        recordDeletion(db, 'corporate_card_transactions', payload.id, actor.userId, {
          reason: payload.reason,
        });
        db.prepare(`DELETE FROM corporate_card_transactions WHERE id = ?`).run(payload.id);
        logActivity(db, actor.userId, 'corpCards.deleteTransaction', `tx:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  ipcMain.handle('corpCards:monthlySummary', (event, period: string) => {
    // 카드별 월 집계 — 임원만.
    requireRole(event, ROLE_SETS.subscriptionCardAdmin);
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
