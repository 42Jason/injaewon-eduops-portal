import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireActor, requireRole, ROLE_SETS } from '../auth';
import { logActivity, recordDeletion } from './shared';

export function registerKnowledgeIpc() {
  // ===========================================================================
  // Manual wiki pages
  // ===========================================================================

  ipcMain.handle('manuals:list', (event) => {
    requireActor(event);
    const db = getDb();
    return db
      .prepare(
        `SELECT id, slug, title, category, parent_id, version, updated_at
           FROM manual_pages
          ORDER BY COALESCE(category, 'ZZZ'), title`,
      )
      .all();
  });

  ipcMain.handle('manuals:get', (event, slug: string) => {
    requireActor(event);
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
      event,
      payload: {
        id?: number;
        slug: string;
        title: string;
        bodyMd: string;
        category?: string;
        authorId: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
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
              actor.userId,
              nowIso,
              payload.id,
            );
          logActivity(db, actor.userId, 'manuals.update', `manual:${payload.id}`, {
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
            actor.userId,
          );
        logActivity(db, actor.userId, 'manuals.create', `manual:${info.lastInsertRowid}`, {
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
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
      const db = getDb();
      // 휴지통 박제: 실패해도 본 DELETE 는 진행.
      recordDeletion(db, 'manual_pages', payload.id, actor.userId, { reason: payload.reason });
      const res = db.prepare(`DELETE FROM manual_pages WHERE id = ?`).run(payload.id);
      logActivity(db, actor.userId, 'manuals.delete', `manual:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ===========================================================================
  // Reports / KPI dashboard
  // ===========================================================================

  ipcMain.handle('reports:kpi', (event) => {
    requireRole(event, ROLE_SETS.regularStaff);
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
    (event, filter?: { action?: string; limit?: number }) => {
      requireRole(event, ROLE_SETS.auditReader);
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

  ipcMain.handle('settings:list', (event) => {
    requireRole(event, ROLE_SETS.opsAdmin);
    const db = getDb();
    return db
      .prepare(`SELECT key, value_json, updated_at FROM admin_settings ORDER BY key`)
      .all();
  });

  ipcMain.handle(
    'settings:set',
    (event, payload: { key: string; valueJson: string; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.leadership);
      const db = getDb();
      try {
        // Validate JSON parseability
        JSON.parse(payload.valueJson);
        db.prepare(
          `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
           VALUES (?, ?, datetime('now'))`,
        ).run(payload.key, payload.valueJson);
        logActivity(db, actor.userId, 'settings.set', `setting:${payload.key}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'invalid_json' };
      }
    },
  );

  // ===========================================================================
  // Employees / users (HR)
  // ===========================================================================

  ipcMain.handle('users:list', (event) => {
    const actor = requireRole(event, ROLE_SETS.peopleReader);
    const revealPrivate =
      (ROLE_SETS.hrAdmin as readonly string[]).includes(actor.role) ||
      (ROLE_SETS.opsAdmin as readonly string[]).includes(actor.role);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.department_id, d.name AS department_name,
                u.title, u.phone, u.active, u.leave_balance, u.joined_at, u.created_at
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
          ORDER BY u.active DESC, u.role, u.name`,
      )
      .all() as Array<Record<string, unknown>>;
    if (revealPrivate) return rows;
    return rows.map((row) => ({
      ...row,
      email: null,
      phone: null,
      leave_balance: null,
      joined_at: null,
      created_at: null,
    }));
  });

  ipcMain.handle(
    'users:update',
    (
      event,
      payload: {
        id: number;
        role?: string;
        departmentId?: number | null;
        title?: string | null;
        phone?: string | null;
        active?: boolean;
        leaveBalance?: number;
        actorId?: number;
      },
    ) => {
      // HR 관리자·임원만 직원 정보 수정 가능. renderer 의 actorId 는 무시.
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
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
      logActivity(db, actor.userId, 'users.update', `user:${payload.id}`, { sets: sets.length });
      return { ok: res.changes > 0 };
    },
  );

  ipcMain.handle('departments:list', (event) => {
    requireActor(event);
    const db = getDb();
    return db.prepare(`SELECT id, name, parent_id FROM departments ORDER BY id`).all();
  });

  // ===========================================================================
  // Notices (expanded)
  // ===========================================================================

  ipcMain.handle(
    'notices:create',
    (
      event,
      payload: {
        authorId: number;
        title: string;
        bodyMd: string;
        audience?: string;
        pinned?: boolean;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
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
            actor.userId,
            payload.audience ?? 'ALL',
            payload.pinned ? 1 : 0,
          );
        logActivity(db, actor.userId, 'notices.create', `notice:${info.lastInsertRowid}`, {});
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  ipcMain.handle(
    'notices:archive',
    (event, payload: { id: number; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.knowledgeEditor);
      const db = getDb();
      const res = db
        .prepare(`UPDATE notices SET archived_at = datetime('now') WHERE id = ?`)
        .run(payload.id);
      logActivity(db, actor.userId, 'notices.archive', `notice:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ===========================================================================
  // Documents (자료실)
  // ===========================================================================

  ipcMain.handle('documents:list', (event, folder?: string) => {
    requireActor(event);
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
      event,
      payload: {
        name: string;
        folder?: string;
        tags?: string;
        mimeType?: string;
        sizeBytes?: number;
        uploaderId: number;
      },
    ) => {
      const actor = requireActor(event);
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
            actor.userId,
          );
        logActivity(db, actor.userId, 'documents.create', `doc:${info.lastInsertRowid}`, {
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
      event,
      filter?: { userId?: number; from?: string; to?: string; limit?: number },
    ) => {
      const actor = requireActor(event);
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      const targetUserId = filter?.userId ?? actor.userId;
      if (targetUserId !== actor.userId) {
        requireRole(event, ROLE_SETS.hrAdmin);
      }
      if (targetUserId != null) {
        where.push('w.user_id = ?');
        params.push(targetUserId);
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
      event,
      payload: {
        userId: number;
        logDate: string;
        summary: string;
        details?: string;
        tags?: string;
      },
    ) => {
      const actor = requireActor(event);
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
            actor.userId,
            payload.logDate,
            payload.summary.trim(),
            payload.details?.trim() ?? null,
            payload.tags?.trim() ?? null,
          );
        logActivity(db, actor.userId, 'workLogs.create', `log:${info.lastInsertRowid}`, {
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
      event,
      payload: {
        id: number;
        userId: number;
        summary?: string;
        details?: string;
        tags?: string;
      },
    ) => {
      const actor = requireActor(event);
      const db = getDb();
      try {
        const row = db
          .prepare(`SELECT user_id FROM work_logs WHERE id = ?`)
          .get(payload.id) as { user_id: number } | undefined;
        if (!row) return { ok: false, error: 'not_found' };
        if (row.user_id !== actor.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
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
        logActivity(db, actor.userId, 'workLogs.update', `log:${payload.id}`, {
          ownerId: row.user_id,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle(
    'workLogs:delete',
    (event, payload: { id: number; userId: number; reason?: string }) => {
      const actor = requireActor(event);
      const db = getDb();
      try {
        const row = db
          .prepare(`SELECT user_id FROM work_logs WHERE id = ?`)
          .get(payload.id) as { user_id: number } | undefined;
        if (!row) return { ok: false, error: 'not_found' };
        if (row.user_id !== actor.userId && !ROLE_SETS.hrAdmin.includes(actor.role as never)) {
          return { ok: false, error: '본인의 일지만 삭제할 수 있습니다.' };
        }
        // 휴지통 박제 후 DELETE
        recordDeletion(db, 'work_logs', payload.id, actor.userId, { reason: payload.reason });
        db.prepare(`DELETE FROM work_logs WHERE id = ?`).run(payload.id);
        logActivity(db, actor.userId, 'workLogs.delete', `log:${payload.id}`, {
          ownerId: row.user_id,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );


}
