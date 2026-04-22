import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireActor, requireRole, ROLE_SETS } from '../auth';
import { dismissEntityNotifications, logActivity, recordNotification } from './shared';

export function registerCsIpc() {
  // ===========================================================================
  // CS tickets
  // ===========================================================================

  ipcMain.handle(
    'cs:list',
    (event, filter?: { status?: string; assigneeId?: number; priority?: string }) => {
      requireRole(event, ROLE_SETS.assignmentReader);
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

  ipcMain.handle('cs:get', (event, id: number) => {
    requireRole(event, ROLE_SETS.assignmentReader);
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
      event,
      payload: {
        channel: 'phone' | 'email' | 'kakao' | 'other';
        studentCode?: string;
        inquirer?: string;
        subject: string;
        body?: string;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        assigneeId?: number;
        relatedAssignmentId?: number;
        actorId?: number;
      },
    ) => {
      const actor = requireActor(event);
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
        const ticketId = Number(info.lastInsertRowid);
        logActivity(db, actor.userId, 'cs.create', `cs:${ticketId}`, { code });
        // 배정된 담당자가 있으면 신규 CS 알림 — 우선순위 urgent/high 는 priority=1.
        if (payload.assigneeId) {
          const prio = payload.priority ?? 'normal';
          recordNotification(db, {
            userId: payload.assigneeId,
            category: 'cs',
            kind: 'cs.assigned',
            title: `CS 배정: ${payload.subject}`,
            body: `[${code}] ${payload.channel}${
              payload.inquirer ? ' · ' + payload.inquirer : ''
            }`,
            link: `/cs?focus=${ticketId}`,
            entityTable: 'cs_tickets',
            entityId: ticketId,
            dedupeKey: `cs:${ticketId}:open`,
            priority: prio === 'urgent' || prio === 'high' ? 1 : 0,
            payload: { code, channel: payload.channel, priority: prio },
          });
        }
        return { ok: true, id: ticketId, code };
      } catch (err) {
        console.error('[ipc] cs:create error', err);
        return { ok: false, error: (err as Error).message ?? 'create_failed' };
      }
    },
  );

  ipcMain.handle(
    'cs:update',
    (
      event,
      payload: {
        id: number;
        status?: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        assigneeId?: number | null;
        body?: string;
        actorId?: number;
      },
    ) => {
      const actor = requireActor(event);
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
        // 업데이트 전에 이전 상태를 기록해서 알림 규칙에 쓰자.
        const before = db
          .prepare(
            `SELECT code, subject, channel, status, priority, assignee_id
               FROM cs_tickets WHERE id = ?`,
          )
          .get(payload.id) as
          | {
              code: string;
              subject: string;
              channel: string;
              status: string;
              priority: string;
              assignee_id: number | null;
            }
          | undefined;

        params.push(payload.id);
        const res = db
          .prepare(`UPDATE cs_tickets SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
        logActivity(db, actor.userId, 'cs.update', `cs:${payload.id}`, { sets: sets.length });

        // --- 알림 규칙 ---
        // (a) status 가 resolved/closed 로 전이되면 이 CS 와 연결된 모든 활성 알림 제거.
        // (b) 담당자가 새로 지정/변경되면 신규 담당자에게 알림.
        // (c) 우선순위가 urgent/high 로 올라가면 담당자(새 담당자 우선)에게 에스컬레이션 알림.
        if (res.changes > 0 && before) {
          const newStatus = payload.status ?? before.status;
          const newPriority = payload.priority ?? before.priority;
          const newAssignee =
            payload.assigneeId === undefined ? before.assignee_id : payload.assigneeId;

          if (
            (newStatus === 'resolved' || newStatus === 'closed') &&
            before.status !== newStatus
          ) {
            dismissEntityNotifications(db, 'cs_tickets', payload.id);
          }

          const assigneeChanged =
            payload.assigneeId !== undefined &&
            payload.assigneeId !== before.assignee_id;
          if (assigneeChanged && newAssignee) {
            recordNotification(db, {
              userId: newAssignee,
              category: 'cs',
              kind: 'cs.assigned',
              title: `CS 재배정: ${before.subject}`,
              body: `[${before.code}] ${before.channel}`,
              link: `/cs?focus=${payload.id}`,
              entityTable: 'cs_tickets',
              entityId: payload.id,
              dedupeKey: `cs:${payload.id}:assign:${newAssignee}`,
              priority:
                newPriority === 'urgent' || newPriority === 'high' ? 1 : 0,
            });
          }

          const priorityEscalated =
            payload.priority !== undefined &&
            (newPriority === 'urgent' || newPriority === 'high') &&
            before.priority !== newPriority;
          if (priorityEscalated && newAssignee) {
            recordNotification(db, {
              userId: newAssignee,
              category: 'cs',
              kind: 'cs.escalated',
              title: `CS 우선순위 상향 (${newPriority}): ${before.subject}`,
              body: `[${before.code}] ${before.priority} → ${newPriority}`,
              link: `/cs?focus=${payload.id}`,
              entityTable: 'cs_tickets',
              entityId: payload.id,
              dedupeKey: `cs:${payload.id}:escalated:${newPriority}`,
              priority: 1,
            });
          }
        }
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] cs:update error', err);
        return { ok: false, error: (err as Error).message ?? 'update_failed' };
      }
    },
  );

  ipcMain.handle('cs:stats', (event) => {
    requireRole(event, ROLE_SETS.assignmentReader);
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


}
