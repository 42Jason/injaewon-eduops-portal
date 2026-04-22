import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireActor, requireRole, ROLE_SETS } from '../auth';
import { dismissEntityNotifications, logActivity, recordNotification } from './shared';

export function registerApprovalsIpc() {
  // ===========================================================================
  // Approvals (전자 결재 다단계)
  // ===========================================================================

  ipcMain.handle(
    'approvals:list',
    (event, filter?: { drafterId?: number; approverId?: number; status?: string }) => {
      const actor = requireActor(event);
      const db = getDb();
      if (filter?.approverId) {
        if (filter.approverId !== actor.userId) {
          requireRole(event, ROLE_SETS.opsAdmin);
        }
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
      const drafterId = filter?.drafterId ?? actor.userId;
      if (drafterId !== actor.userId) {
        requireRole(event, ROLE_SETS.opsAdmin);
      }
      if (drafterId) {
        where.push('a.drafter_id = ?');
        params.push(drafterId);
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

  ipcMain.handle('approvals:get', (event, id: number) => {
    const actor = requireActor(event);
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
    const h = header as { drafter_id: number };
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
    const isRelated =
      h.drafter_id === actor.userId ||
      (steps as Array<{ approver_id: number }>).some((s) => s.approver_id === actor.userId);
    if (!isRelated) {
      requireRole(event, ROLE_SETS.opsAdmin);
    }
    return { ...header, steps };
  });

  ipcMain.handle(
    'approvals:create',
    (
      event,
      payload: {
        drafterId: number;
        title: string;
        kind: string;
        payload?: Record<string, unknown>;
        approverIds: number[];
      },
    ) => {
      const actor = requireActor(event);
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
              actor.userId,
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
        logActivity(db, actor.userId, 'approvals.create', `approval:${res.aid}`, {
          code: res.code,
        });
        // 1단계 승인자에게만 먼저 알림 — 순차 결재라서 뒤 단계는 앞이 승인돼야 차례.
        const firstApprover = payload.approverIds[0];
        if (firstApprover) {
          recordNotification(db, {
            userId: firstApprover,
            category: 'approval',
            kind: 'approval.requested',
            title: `결재 요청: ${payload.title}`,
            body: `[${res.code}] ${payload.kind} · 기안자 #${actor.userId}`,
            link: `/approvals?focus=${res.aid}`,
            entityTable: 'approvals',
            entityId: res.aid,
            dedupeKey: `approval:${res.aid}:pending`,
            priority: 1,
            payload: { code: res.code, kind: payload.kind, drafterId: actor.userId },
          });
        }
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
      event,
      payload: {
        approvalId: number;
        approverId: number;
        decision: 'approved' | 'rejected';
        comment?: string;
      },
    ) => {
      const actor = requireActor(event);
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
          .get(payload.approvalId, actor.userId) as
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
        logActivity(db, actor.userId, 'approvals.decide', `approval:${payload.approvalId}`, {
          decision: payload.decision,
          finalStatus: res.finalStatus,
        });

        // 알림 전파 ----------------------------------------------------------
        // 이 승인자의 미처리 "결재 요청" 알림은 처리 완료이므로 드로워에서 걷어낸다.
        dismissEntityNotifications(db, 'approvals', payload.approvalId);

        const approvalMeta = db
          .prepare(
            `SELECT code, title, drafter_id FROM approvals WHERE id = ?`,
          )
          .get(payload.approvalId) as
          | { code: string; title: string; drafter_id: number }
          | undefined;

        if (res.finalStatus === 'pending' && approvalMeta) {
          // 다음 단계 승인자에게 새 요청 알림.
          const next = db
            .prepare(
              `SELECT approver_id FROM approval_steps
                WHERE approval_id = ? AND state = 'pending'
                ORDER BY step_order ASC LIMIT 1`,
            )
            .get(payload.approvalId) as { approver_id: number } | undefined;
          if (next?.approver_id) {
            recordNotification(db, {
              userId: next.approver_id,
              category: 'approval',
              kind: 'approval.requested',
              title: `결재 요청: ${approvalMeta.title}`,
              body: `[${approvalMeta.code}] · 이전 단계 승인 완료, 귀하 차례입니다`,
              link: `/approvals?focus=${payload.approvalId}`,
              entityTable: 'approvals',
              entityId: payload.approvalId,
              dedupeKey: `approval:${payload.approvalId}:pending`,
              priority: 1,
            });
          }
        } else if (approvalMeta) {
          // 최종 결과를 기안자에게 통지.
          const resultKind = res.finalStatus === 'approved' ? '승인' : '반려';
          recordNotification(db, {
            userId: approvalMeta.drafter_id,
            category: 'approval',
            kind: `approval.${res.finalStatus}`,
            title: `결재 ${resultKind}: ${approvalMeta.title}`,
            body: payload.comment
              ? `[${approvalMeta.code}] ${payload.comment}`
              : `[${approvalMeta.code}]`,
            link: `/approvals?focus=${payload.approvalId}`,
            entityTable: 'approvals',
            entityId: payload.approvalId,
            dedupeKey: `approval:${payload.approvalId}:${res.finalStatus}`,
            priority: res.finalStatus === 'rejected' ? 1 : 0,
          });
        }

        return { ok: true, finalStatus: res.finalStatus };
      } catch (err) {
        console.error('[ipc] approvals:decide error', err);
        return { ok: false, error: (err as Error).message ?? 'decide_failed' };
      }
    },
  );

  ipcMain.handle(
    'approvals:withdraw',
    (event, payload: { approvalId: number; drafterId: number }) => {
      const actor = requireActor(event);
      const db = getDb();
      const res = db
        .prepare(
          `UPDATE approvals SET status = 'withdrawn', closed_at = datetime('now')
            WHERE id = ? AND drafter_id = ? AND status = 'pending'`,
        )
        .run(payload.approvalId, actor.userId);
      logActivity(db, actor.userId, 'approvals.withdraw', `approval:${payload.approvalId}`, {});
      return { ok: res.changes > 0 };
    },
  );


}
