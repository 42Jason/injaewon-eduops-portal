import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireActor, requireRole, ROLE_SETS } from '../auth';

// ===========================================================================
// Notifications IPC (v0.1.16)
// ===========================================================================
export function registerNotificationsIpc() {
  interface NotificationRow {
    id: number;
    user_id: number;
    category: string;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    entity_table: string | null;
    entity_id: number | null;
    priority: number;
    payload_json: string | null;
    read_at: string | null;
    snooze_until: string | null;
    dismissed_at: string | null;
    created_at: string;
  }

  function mapRow(row: NotificationRow) {
    let payload: Record<string, unknown> | null = null;
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }
    return {
      id: row.id,
      userId: row.user_id,
      category: row.category,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      entityTable: row.entity_table,
      entityId: row.entity_id,
      priority: row.priority,
      payload,
      readAt: row.read_at,
      snoozeUntil: row.snooze_until,
      dismissedAt: row.dismissed_at,
      createdAt: row.created_at,
    };
  }

  // ------------------------------------------------------------------ list
  ipcMain.handle(
    'notifications:list',
    (
      event,
      payload?: {
        userId?: number;
        status?: 'unread' | 'read' | 'dismissed' | 'all';
        category?: string | null;
        limit?: number;
      },
    ) => {
      const actor = requireActor(event);
      const db = getDb();
      const userId = payload?.userId ?? actor.userId;
      // 본인이 아닌 다른 사람 알림은 opsAdmin 만 조회 가능.
      if (userId !== actor.userId) {
        requireRole(event, ROLE_SETS.opsAdmin);
      }
      const status = payload?.status ?? 'all';
      const limit = Math.max(1, Math.min(500, payload?.limit ?? 100));

      const where: string[] = ['user_id = ?'];
      const params: unknown[] = [userId];

      // 스누즈 중인 알림은 스누즈 해제 전까지 드로워에서 숨긴다.
      where.push(`(snooze_until IS NULL OR snooze_until <= datetime('now'))`);

      if (status === 'unread') {
        where.push('read_at IS NULL');
        where.push('dismissed_at IS NULL');
      } else if (status === 'read') {
        where.push('read_at IS NOT NULL');
        where.push('dismissed_at IS NULL');
      } else if (status === 'dismissed') {
        where.push('dismissed_at IS NOT NULL');
      } else {
        // 'all' 에서도 기본적으로 처리완료(dismissed) 는 제외 — 필요 시 filter 로
        // 'dismissed' 따로 조회.
        where.push('dismissed_at IS NULL');
      }

      if (payload?.category && payload.category !== 'all') {
        where.push('category = ?');
        params.push(payload.category);
      }

      params.push(limit);

      const rows = db
        .prepare(
          `SELECT * FROM notifications
            WHERE ${where.join(' AND ')}
            ORDER BY priority DESC, created_at DESC
            LIMIT ?`,
        )
        .all(...params) as NotificationRow[];

      return rows.map(mapRow);
    },
  );

  // ------------------------------------------------------------------ stats
  ipcMain.handle('notifications:stats', (event, payload?: { userId?: number }) => {
    const actor = requireActor(event);
    const db = getDb();
    const userId = payload?.userId ?? actor.userId;
    if (userId !== actor.userId) requireRole(event, ROLE_SETS.opsAdmin);

    const byCategory = db
      .prepare(
        `SELECT category, COUNT(*) AS count
           FROM notifications
          WHERE user_id = ?
            AND dismissed_at IS NULL
            AND read_at IS NULL
            AND (snooze_until IS NULL OR snooze_until <= datetime('now'))
          GROUP BY category`,
      )
      .all(userId) as Array<{ category: string; count: number }>;

    const total = byCategory.reduce((acc, r) => acc + r.count, 0);
    return { total, byCategory };
  });

  // ------------------------------------------------------------------ markRead
  ipcMain.handle(
    'notifications:markRead',
    (event, payload: { ids?: number[]; all?: boolean; category?: string }) => {
      const actor = requireActor(event);
      const db = getDb();
      if (payload?.all) {
        const info =
          payload.category && payload.category !== 'all'
            ? db
                .prepare(
                  `UPDATE notifications
                      SET read_at = datetime('now')
                    WHERE user_id = ? AND category = ?
                      AND read_at IS NULL AND dismissed_at IS NULL`,
                )
                .run(actor.userId, payload.category)
            : db
                .prepare(
                  `UPDATE notifications
                      SET read_at = datetime('now')
                    WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL`,
                )
                .run(actor.userId);
        return { ok: true as const, updated: info.changes };
      }
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((n) => Number.isInteger(n)) : [];
      if (ids.length === 0) return { ok: true as const, updated: 0 };
      const placeholders = ids.map(() => '?').join(',');
      const info = db
        .prepare(
          `UPDATE notifications
              SET read_at = datetime('now')
            WHERE user_id = ? AND id IN (${placeholders}) AND read_at IS NULL`,
        )
        .run(actor.userId, ...ids);
      return { ok: true as const, updated: info.changes };
    },
  );

  // ------------------------------------------------------------------ dismiss
  ipcMain.handle('notifications:dismiss', (event, payload: { ids: number[] }) => {
    const actor = requireActor(event);
    const db = getDb();
    const ids = Array.isArray(payload?.ids) ? payload.ids.filter((n) => Number.isInteger(n)) : [];
    if (ids.length === 0) return { ok: true as const, updated: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const info = db
      .prepare(
        `UPDATE notifications
            SET dismissed_at = datetime('now'),
                read_at = COALESCE(read_at, datetime('now'))
          WHERE user_id = ? AND id IN (${placeholders})`,
      )
      .run(actor.userId, ...ids);
    return { ok: true as const, updated: info.changes };
  });

  // ------------------------------------------------------------------ snooze
  ipcMain.handle(
    'notifications:snooze',
    (event, payload: { ids: number[]; until: string | null }) => {
      const actor = requireActor(event);
      const db = getDb();
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((n) => Number.isInteger(n)) : [];
      if (ids.length === 0) return { ok: true as const, updated: 0 };
      const placeholders = ids.map(() => '?').join(',');
      const info = db
        .prepare(
          `UPDATE notifications
              SET snooze_until = ?
            WHERE user_id = ? AND id IN (${placeholders})`,
        )
        .run(payload?.until ?? null, actor.userId, ...ids);
      return { ok: true as const, updated: info.changes };
    },
  );
}
