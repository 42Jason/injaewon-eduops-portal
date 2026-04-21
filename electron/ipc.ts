import { ipcMain, BrowserWindow, safeStorage, app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, getDbPath } from './db';
import {
  login,
  setSession,
  clearSession,
  getActor,
  requireActor,
  requireRole,
  ROLE_SETS,
  AuthError,
} from './auth';
import { parseInstructionExcel, type ParsedRow } from './parseExcel';
import {
  calcRegularPayroll,
  calcFreelancerPayroll,
  type RegularPayrollProfile,
  type RegularPayrollInputs,
} from './payroll-calc';
import { NotionSync, type NotionSettings } from './notion-sync';

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
  //  로그인 성공하면 event.sender.id (= webContents.id) 를 키로 세션 맵에 등록.
  //  이후 모든 민감 IPC 는 renderer 의 actorId 대신 이 세션을 신뢰.
  ipcMain.handle('auth:login', (event, payload: { email: string; password: string }) => {
    try {
      const result = login(getDb(), payload.email, payload.password);
      if (result.ok && result.user) {
        setSession(event.sender.id, result.user);
      }
      return result;
    } catch (err) {
      console.error('[ipc] auth:login error', err);
      return { ok: false, error: 'server_error' };
    }
  });

  ipcMain.handle('auth:logout', (event) => {
    clearSession(event.sender.id);
    return { ok: true };
  });

  // renderer 가 hydrate 직후 "내가 현재 세션이 있나?" 물어보는 핸들러.
  //  localStorage 위조로 세션 행세하는 걸 막기 위해, main 이 실제로 보유한
  //  actor 만 돌려줌. null 이면 renderer 는 즉시 로그아웃 처리.
  ipcMain.handle('auth:me', (event) => {
    const actor = getActor(event);
    if (!actor) return { ok: false as const };
    return {
      ok: true as const,
      actor: {
        userId: actor.userId,
        email: actor.email,
        name: actor.name,
        role: actor.role,
        departmentId: actor.departmentId,
      },
    };
  });

  // BrowserWindow 가 닫히면 세션을 반드시 정리 — 다음에 같은 webContents.id
  //  가 재사용될 때 이전 actor 가 남아있지 않도록.
  const cleanupOnClose = (win: BrowserWindow) => {
    const id = win.webContents.id;
    win.on('closed', () => clearSession(id));
  };
  BrowserWindow.getAllWindows().forEach(cleanupOnClose);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  app.on('browser-window-created', (_e, win) => cleanupOnClose(win));

  // -- assignments ------------------------------------------------------------
  ipcMain.handle(
    'assignments:list',
    (
      _e,
      filter?: {
        state?: string;
        assignee?: number;
        search?: string;
        includeDeleted?: boolean;
        onlyDeleted?: boolean;
      },
    ) => {
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.onlyDeleted) {
        where.push('a.deleted_at IS NOT NULL');
      } else if (!filter?.includeDeleted) {
        where.push('a.deleted_at IS NULL');
      }
      if (filter?.state) {
        where.push('a.state = ?');
        params.push(filter.state);
      }
      if (filter?.assignee) {
        where.push('(a.parser_id = ? OR a.qa1_id = ? OR a.qa_final_id = ?)');
        params.push(filter.assignee, filter.assignee, filter.assignee);
      }
      if (filter?.search) {
        const q = `%${filter.search}%`;
        where.push(
          '(a.code LIKE ? OR a.title LIKE ? OR a.subject LIKE ? OR a.student_code LIKE ?)',
        );
        params.push(q, q, q, q);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const rows = db
        .prepare(
          `SELECT a.id, a.code, a.subject, a.publisher, a.student_code, a.title,
                  a.scope, a.state, a.risk, a.parser_id, a.qa1_id, a.qa_final_id,
                  a.due_at, a.received_at, a.completed_at, a.deleted_at,
                  up.name AS parser_name, uq.name AS qa1_name, uf.name AS qa_final_name
             FROM assignments a
             LEFT JOIN users up ON up.id = a.parser_id
             LEFT JOIN users uq ON uq.id = a.qa1_id
             LEFT JOIN users uf ON uf.id = a.qa_final_id
             ${whereSql}
            ORDER BY a.due_at ASC, a.id DESC
            LIMIT 300`,
        )
        .all(...params);
      return rows;
    },
  );

  ipcMain.handle(
    'assignments:get',
    (_e, payload: number | { id: number; includeDeleted?: boolean }) => {
      const db = getDb();
      const id = typeof payload === 'number' ? payload : payload.id;
      const includeDeleted =
        typeof payload === 'number' ? false : !!payload.includeDeleted;
      const deletedGuard = includeDeleted ? '' : 'AND a.deleted_at IS NULL';
      const row = db
        .prepare(
          `SELECT a.*, up.name AS parser_name, uq.name AS qa1_name, uf.name AS qa_final_name
             FROM assignments a
             LEFT JOIN users up ON up.id = a.parser_id
             LEFT JOIN users uq ON uq.id = a.qa1_id
             LEFT JOIN users uf ON uf.id = a.qa_final_id
            WHERE a.id = ? ${deletedGuard}`,
        )
        .get(id);
      return row ?? null;
    },
  );

  // -- assignments CRUD (수동 추가 / 편집 / 소프트 삭제 / 복원 / 일괄) -----------
  const ASSIGNMENT_STATES = [
    '신규접수',
    '자료누락',
    '파싱대기',
    '파싱진행중',
    '파싱완료',
    '파싱확인필요',
    '1차QA대기',
    '1차QA진행중',
    '1차QA반려',
    '최종QA대기',
    '최종QA진행중',
    '최종QA반려',
    '승인완료',
    '수정요청',
    '완료',
    '보류',
  ] as const;
  const ASSIGNMENT_RISKS = ['low', 'medium', 'high'] as const;

  function nextAssignmentCode(db: ReturnType<typeof getDb>): string {
    interface MaxRow {
      max_num: number | null;
    }
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(CAST(SUBSTR(code, 3) AS INTEGER)), 0) AS max_num
           FROM assignments
          WHERE code LIKE 'A-%'`,
      )
      .get() as MaxRow;
    const next = (row?.max_num ?? 0) + 1;
    return `A-${String(next).padStart(4, '0')}`;
  }

  ipcMain.handle(
    'assignments:create',
    (
      event,
      payload: {
        actorId?: number | null;
        subject: string;
        title: string;
        studentId?: number | null;
        studentCode?: string | null;
        publisher?: string | null;
        scope?: string | null;
        lengthReq?: string | null;
        outline?: string | null;
        rubric?: string | null;
        teacherReq?: string | null;
        studentReq?: string | null;
        state?: string;
        risk?: string;
        parserId?: number | null;
        qa1Id?: number | null;
        qaFinalId?: number | null;
        dueAt?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        const db = getDb();
        if (!payload?.subject?.trim() || !payload?.title?.trim()) {
          return { ok: false, error: 'missing_required' };
        }
        const state = payload.state && ASSIGNMENT_STATES.includes(payload.state as typeof ASSIGNMENT_STATES[number])
          ? payload.state
          : '신규접수';
        const risk = payload.risk && ASSIGNMENT_RISKS.includes(payload.risk as typeof ASSIGNMENT_RISKS[number])
          ? payload.risk
          : 'low';

        // Resolve student_code — prefer explicit, fallback to students table lookup.
        let studentCode = payload.studentCode ?? null;
        if (!studentCode && payload.studentId) {
          const s = db
            .prepare('SELECT student_code FROM students WHERE id = ?')
            .get(payload.studentId) as { student_code: string } | undefined;
          studentCode = s?.student_code ?? null;
        }
        if (!studentCode) {
          // 필수 NOT NULL 이지만 학생 미연결일 수도 있음 → sentinel 값 사용
          studentCode = '-';
        }

        const code = nextAssignmentCode(db);

        const info = db
          .prepare(
            `INSERT INTO assignments (
                code, subject, publisher, student_id, student_code,
                title, scope, length_req, outline, rubric,
                teacher_req, student_req, state, risk,
                parser_id, qa1_id, qa_final_id, due_at
              ) VALUES (?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?)`,
          )
          .run(
            code,
            payload.subject.trim(),
            payload.publisher ?? null,
            payload.studentId ?? null,
            studentCode,
            payload.title.trim(),
            payload.scope ?? null,
            payload.lengthReq ?? null,
            payload.outline ?? null,
            payload.rubric ?? null,
            payload.teacherReq ?? null,
            payload.studentReq ?? null,
            state,
            risk,
            payload.parserId ?? null,
            payload.qa1Id ?? null,
            payload.qaFinalId ?? null,
            payload.dueAt ?? null,
          );

        const id = Number(info.lastInsertRowid);
        logActivity(db, actor.userId, 'assignments.create', `assignment:${id}`, {
          code,
          title: payload.title,
          subject: payload.subject,
          state,
        });
        return { ok: true, id, code };
      } catch (err) {
        console.error('[ipc] assignments:create failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:update',
    (
      event,
      payload: {
        id: number;
        actorId?: number | null;
        subject?: string;
        title?: string;
        publisher?: string | null;
        studentId?: number | null;
        studentCode?: string | null;
        scope?: string | null;
        lengthReq?: string | null;
        outline?: string | null;
        rubric?: string | null;
        teacherReq?: string | null;
        studentReq?: string | null;
        state?: string;
        risk?: string;
        parserId?: number | null;
        qa1Id?: number | null;
        qaFinalId?: number | null;
        dueAt?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      try {
        const db = getDb();
        const map: Array<[keyof typeof payload, string]> = [
          ['subject', 'subject'],
          ['title', 'title'],
          ['publisher', 'publisher'],
          ['studentId', 'student_id'],
          ['studentCode', 'student_code'],
          ['scope', 'scope'],
          ['lengthReq', 'length_req'],
          ['outline', 'outline'],
          ['rubric', 'rubric'],
          ['teacherReq', 'teacher_req'],
          ['studentReq', 'student_req'],
          ['state', 'state'],
          ['risk', 'risk'],
          ['parserId', 'parser_id'],
          ['qa1Id', 'qa1_id'],
          ['qaFinalId', 'qa_final_id'],
          ['dueAt', 'due_at'],
        ];
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [key, col] of map) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            sets.push(`${col} = ?`);
            params.push((payload as Record<string, unknown>)[key] ?? null);
          }
        }
        if (sets.length === 0) return { ok: false, error: 'no_fields' };
        sets.push("updated_at = datetime('now')");
        params.push(payload.id);
        const info = db
          .prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
        if (info.changes === 0) return { ok: false, error: 'not_found' };
        logActivity(db, actor.userId, 'assignments.update', `assignment:${payload.id}`, {
          keys: Object.keys(payload).filter(
            (k) => k !== 'id' && k !== 'actorId',
          ),
        });
        // state 변경 시 보관함 동기화
        if (payload.state) {
          syncAssignmentArchive(db, payload.id, payload.state, actor.userId);
        }
        return { ok: true };
      } catch (err) {
        console.error('[ipc] assignments:update failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:softDelete',
    (event, payload: { id: number; actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      try {
        const db = getDb();
        const tx = db.transaction(() => {
          const info = db
            .prepare(
              `UPDATE assignments
                  SET deleted_at = datetime('now'),
                      updated_at = datetime('now')
                WHERE id = ? AND deleted_at IS NULL`,
            )
            .run(payload.id);
          if (info.changes > 0) {
            // 승인완료 상태였다면 자동 보관함 링크도 회수
            syncAssignmentArchive(db, payload.id, '보류', actor.userId);
          }
          return info.changes;
        });
        const changes = tx();
        if (changes === 0) return { ok: false, error: 'not_found_or_already_deleted' };
        logActivity(db, actor.userId, 'assignments.softDelete', `assignment:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        console.error('[ipc] assignments:softDelete failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:restore',
    (event, payload: { id: number; actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      try {
        const db = getDb();
        const info = db
          .prepare(
            `UPDATE assignments
                SET deleted_at = NULL,
                    updated_at = datetime('now')
              WHERE id = ? AND deleted_at IS NOT NULL`,
          )
          .run(payload.id);
        if (info.changes === 0) return { ok: false, error: 'not_found_or_active' };
        logActivity(db, actor.userId, 'assignments.restore', `assignment:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        console.error('[ipc] assignments:restore failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:bulkSetState',
    (
      event,
      payload: { ids: number[]; state: string; actorId?: number | null },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      try {
        if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
          return { ok: false, error: 'empty_ids' };
        }
        if (!ASSIGNMENT_STATES.includes(payload.state as typeof ASSIGNMENT_STATES[number])) {
          return { ok: false, error: 'invalid_state' };
        }
        const db = getDb();
        const now = new Date().toISOString();
        const completedMark = ['완료', '승인완료'].includes(payload.state);
        let changed = 0;
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            `UPDATE assignments
                SET state = ?,
                    updated_at = ?,
                    completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END
              WHERE id = ? AND deleted_at IS NULL`,
          );
          for (const id of payload.ids) {
            const res = stmt.run(payload.state, now, completedMark ? 1 : 0, now, id);
            if (res.changes > 0) {
              changed += 1;
              syncAssignmentArchive(db, id, payload.state, actor.userId);
            }
          }
        });
        tx();
        logActivity(db, actor.userId, 'assignments.bulkSetState', 'assignment:bulk', {
          ids: payload.ids,
          state: payload.state,
          changed,
        });
        return { ok: true, changed };
      } catch (err) {
        console.error('[ipc] assignments:bulkSetState failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:bulkAssign',
    (
      event,
      payload: {
        ids: number[];
        parserId?: number | null;
        qa1Id?: number | null;
        qaFinalId?: number | null;
        actorId?: number | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      try {
        if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
          return { ok: false, error: 'empty_ids' };
        }
        const sets: string[] = [];
        const baseParams: unknown[] = [];
        if (Object.prototype.hasOwnProperty.call(payload, 'parserId')) {
          sets.push('parser_id = ?');
          baseParams.push(payload.parserId ?? null);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'qa1Id')) {
          sets.push('qa1_id = ?');
          baseParams.push(payload.qa1Id ?? null);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'qaFinalId')) {
          sets.push('qa_final_id = ?');
          baseParams.push(payload.qaFinalId ?? null);
        }
        if (sets.length === 0) return { ok: false, error: 'no_fields' };
        sets.push("updated_at = datetime('now')");
        const db = getDb();
        let changed = 0;
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            `UPDATE assignments
                SET ${sets.join(', ')}
              WHERE id = ? AND deleted_at IS NULL`,
          );
          for (const id of payload.ids) {
            const res = stmt.run(...baseParams, id);
            if (res.changes > 0) changed += 1;
          }
        });
        tx();
        logActivity(db, actor.userId, 'assignments.bulkAssign', 'assignment:bulk', {
          ids: payload.ids,
          parserId: payload.parserId,
          qa1Id: payload.qa1Id,
          qaFinalId: payload.qaFinalId,
          changed,
        });
        return { ok: true, changed };
      } catch (err) {
        console.error('[ipc] assignments:bulkAssign failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  ipcMain.handle(
    'assignments:bulkDelete',
    (event, payload: { ids: number[]; actorId?: number | null }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      try {
        if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
          return { ok: false, error: 'empty_ids' };
        }
        const db = getDb();
        let changed = 0;
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            `UPDATE assignments
                SET deleted_at = datetime('now'),
                    updated_at = datetime('now')
              WHERE id = ? AND deleted_at IS NULL`,
          );
          for (const id of payload.ids) {
            // 휴지통 박제 — 복원 가능하도록 행 전체 JSON 보관
            recordDeletion(db, 'assignments', id, actor.userId, { reason: 'bulk delete' });
            const res = stmt.run(id);
            if (res.changes > 0) {
              changed += 1;
              syncAssignmentArchive(db, id, '보류', actor.userId);
            }
          }
        });
        tx();
        logActivity(db, actor.userId, 'assignments.bulkDelete', 'assignment:bulk', {
          ids: payload.ids,
          changed,
        });
        return { ok: true, changed };
      } catch (err) {
        console.error('[ipc] assignments:bulkDelete failed', err);
        return { ok: false, error: 'server_error', message: String(err) };
      }
    },
  );

  /**
   * Transition an assignment to a new state.
   * Very thin — no role check here (UI guards for now). In Phase 2 we'll
   * move role enforcement server-side and log to `activity`.
   */
  ipcMain.handle(
    'assignments:setState',
    (event, payload: { id: number; state: string; actorId?: number; note?: string }) => {
      const actor = requireRole(event, ROLE_SETS.parser);
      const db = getDb();
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        const res = db
          .prepare(
            `UPDATE assignments
                SET state = ?,
                    updated_at = ?,
                    completed_at = CASE WHEN ? IN ('완료','승인완료') THEN ? ELSE completed_at END
              WHERE id = ?`,
          )
          .run(payload.state, now, payload.state, now, payload.id);
        if (res.changes > 0) {
          syncAssignmentArchive(db, payload.id, payload.state, actor.userId);
        }
        return res.changes > 0;
      });
      return { ok: tx() };
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
        logActivity(db, actor.userId, 'cs.create', `cs:${info.lastInsertRowid}`, { code });
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
        params.push(payload.id);
        const res = db
          .prepare(`UPDATE cs_tickets SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
        logActivity(db, actor.userId, 'cs.update', `cs:${payload.id}`, { sets: sets.length });
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
          // 최종 승인 → 보관함에 자동 추가 / 그 외 상태로 바뀌면 자동 레코드 제거
          syncAssignmentArchive(db, payload.assignmentId, nextState, payload.reviewerId);
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
    (event, payload: { id: number; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
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
    (_e, payload: { id: number; userId: number; reason?: string }) => {
      const db = getDb();
      try {
        const row = db
          .prepare(`SELECT user_id FROM work_logs WHERE id = ?`)
          .get(payload.id) as { user_id: number } | undefined;
        if (!row) return { ok: false, error: 'not_found' };
        if (row.user_id !== payload.userId) {
          return { ok: false, error: '본인의 일지만 삭제할 수 있습니다.' };
        }
        // 휴지통 박제 후 DELETE
        recordDeletion(db, 'work_logs', payload.id, payload.userId, { reason: payload.reason });
        db.prepare(`DELETE FROM work_logs WHERE id = ?`).run(payload.id);
        logActivity(db, payload.userId, 'workLogs.delete', `log:${payload.id}`, {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  registerAdminIpc();
  registerStudentArchiveIpc();
  registerReleaseIpc(meta.version);
  registerParsingUploadsIpc();
  registerTrashIpc();
}

// ===========================================================================
// Administrative IPC — tuition / payroll / subscriptions / corporate cards
// Broken into its own function so the file stays navigable.
// ===========================================================================
function registerAdminIpc() {
  // -------------------------------------------------------------------------
  // Tuition billing
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'tuition:listStudents',
    (_e, filter?: { active?: boolean; search?: string }) => {
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
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
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
    (_e, filter?: { period?: string; status?: string; studentId?: number }) => {
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
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
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
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
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
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
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
        return { ok: true, paidAmount: result.newPaid, status: result.newStatus };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'record_failed' };
      }
    },
  );

  ipcMain.handle('tuition:listPayments', (event, invoiceId: number) => {
    // 납부 내역 — 운영 관리자 이상만.
    requireRole(event, ROLE_SETS.opsAdmin);
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
    requireRole(event, ROLE_SETS.opsAdmin);
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

  // -------------------------------------------------------------------------
  // Recurring subscriptions (정기 결제)
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'subscriptions:list',
    (event, filter?: { status?: string; cardId?: number }) => {
      // 정기결제 목록은 임원(CEO/CTO)만 — 법인카드·금액 노출.
      requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
    requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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

  // -------------------------------------------------------------------------
  // Corporate cards
  // -------------------------------------------------------------------------

  ipcMain.handle('corpCards:list', (event, filter?: { status?: string }) => {
    // 법인카드 목록 — 임원만.
    requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
      requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
      const actor = requireRole(event, ROLE_SETS.leadership);
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
    requireRole(event, ROLE_SETS.leadership);
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

// ===========================================================================
// Student information archive (학생 정보 보관함)
//  - list / get students + full activity history (assignments + parsing_results)
//  - report topics CRUD
//  - archive files CRUD (metadata only — file bytes live elsewhere for now)
// ===========================================================================
function registerStudentArchiveIpc() {
  // ---- students listing --------------------------------------------------
  ipcMain.handle(
    'students:list',
    (_e, filter?: { q?: string; limit?: number; includeDeleted?: boolean }) => {
      const db = getDb();
      const where: string[] = [];
      if (!filter?.includeDeleted) where.push('s.deleted_at IS NULL');
      const params: unknown[] = [];
      if (filter?.q && filter.q.trim()) {
        where.push(
          '(s.name LIKE ? OR s.student_code LIKE ? OR s.school LIKE ? OR s.school_no LIKE ? OR s.guardian LIKE ? OR s.phone LIKE ? OR s.guardian_phone LIKE ?)',
        );
        const like = `%${filter.q.trim()}%`;
        params.push(like, like, like, like, like, like, like);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const lim = Math.min(Math.max(filter?.limit ?? 500, 1), 2000);
      return db
        .prepare(
          `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.school_no,
                  s.phone, s.guardian, s.guardian_phone, s.grade_memo, s.memo,
                  s.notion_page_id, s.notion_source, s.notion_synced_at,
                  s.created_at, s.deleted_at,
                  (SELECT COUNT(*) FROM assignments a WHERE a.student_id = s.id AND a.deleted_at IS NULL) AS assignment_count,
                  (SELECT COUNT(*) FROM student_report_topics t WHERE t.student_id = s.id) AS topic_count,
                  (SELECT COUNT(*) FROM student_archive_files f WHERE f.student_id = s.id) AS file_count,
                  (SELECT COUNT(*) FROM student_grades g WHERE g.student_id = s.id) AS grade_count,
                  (SELECT COUNT(*) FROM student_counseling_logs c WHERE c.student_id = s.id) AS counseling_count
             FROM students s
            ${whereSql}
            ORDER BY s.name ASC, s.student_code ASC
            LIMIT ${lim}`,
        )
        .all(...params);
    },
  );

  ipcMain.handle('students:get', (_e, studentId: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT s.id, s.student_code, s.name, s.grade, s.school, s.school_no,
                s.phone, s.guardian, s.guardian_phone, s.grade_memo, s.memo,
                s.monthly_fee, s.billing_day, s.billing_active,
                s.notion_page_id, s.notion_source, s.notion_synced_at,
                s.created_at, s.deleted_at
           FROM students s
          WHERE s.id = ?`,
      )
      .get(studentId);
    return row ?? null;
  });

  // ---- students CRUD -----------------------------------------------------
  // 수동 학생 추가. student_code 는 비워오면 'M-<타임스탬프>' 자동 발급.
  ipcMain.handle(
    'students:create',
    (
      event,
      payload: {
        studentCode?: string | null;
        name: string;
        grade?: string | null;
        school?: string | null;
        schoolNo?: string | null;
        phone?: string | null;
        guardian?: string | null;
        guardianPhone?: string | null;
        gradeMemo?: string | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        const name = payload.name?.trim();
        if (!name) return { ok: false, error: 'name_required' };
        let code = payload.studentCode?.trim();
        if (!code) {
          // 'M-<yyMMddHHmm>-<rand>' 형태로 충돌 최소화
          const d = new Date();
          const pad = (n: number) => n.toString().padStart(2, '0');
          const stamp = `${d.getFullYear().toString().slice(-2)}${pad(d.getMonth() + 1)}${pad(
            d.getDate(),
          )}${pad(d.getHours())}${pad(d.getMinutes())}`;
          code = `M-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        }
        // UNIQUE 충돌 시 재발급
        const existing = db
          .prepare(`SELECT id FROM students WHERE student_code = ?`)
          .get(code);
        if (existing) {
          return { ok: false, error: 'code_conflict', message: `학생 코드 "${code}" 가 이미 존재합니다.` };
        }
        const info = db
          .prepare(
            `INSERT INTO students (
               student_code, name, grade, school, school_no,
               phone, guardian, guardian_phone, grade_memo, memo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            code,
            name,
            payload.grade ?? null,
            payload.school ?? null,
            payload.schoolNo ?? null,
            payload.phone ?? null,
            payload.guardian ?? null,
            payload.guardianPhone ?? null,
            payload.gradeMemo ?? null,
            payload.memo ?? null,
          );
        logActivity(db, actor.userId, 'students.create', `student:${info.lastInsertRowid}`, {
          studentCode: code,
          name,
        });
        return { ok: true, id: Number(info.lastInsertRowid), studentCode: code };
      } catch (err) {
        console.error('[ipc] students:create error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:update',
    (
      event,
      payload: {
        id: number;
        name?: string;
        grade?: string | null;
        school?: string | null;
        schoolNo?: string | null;
        phone?: string | null;
        guardian?: string | null;
        guardianPhone?: string | null;
        gradeMemo?: string | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        const fields: string[] = [];
        const params: unknown[] = [];
        const map: Array<[keyof typeof payload, string]> = [
          ['name', 'name'],
          ['grade', 'grade'],
          ['school', 'school'],
          ['schoolNo', 'school_no'],
          ['phone', 'phone'],
          ['guardian', 'guardian'],
          ['guardianPhone', 'guardian_phone'],
          ['gradeMemo', 'grade_memo'],
          ['memo', 'memo'],
        ];
        for (const [key, col] of map) {
          const v = payload[key];
          if (v !== undefined) {
            fields.push(`${col} = ?`);
            params.push(v);
          }
        }
        if (fields.length === 0) return { ok: false, error: 'no_fields' };
        params.push(payload.id);
        const res = db
          .prepare(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`)
          .run(...params);
        logActivity(db, actor.userId, 'students.update', `student:${payload.id}`, {
          changed: fields.length,
        });
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] students:update error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:softDelete',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      // 학생 삭제는 운영관리자·임원만 가능.
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        // students 는 이미 deleted_at 로 soft-delete 되지만, 휴지통 UI 통합을
        // 위해 tombstone 도 같이 기록한다. 복원 시 두 경로 모두 처리.
        recordDeletion(db, 'students', payload.id, actor.userId, { reason: payload.reason });
        const res = db
          .prepare(
            `UPDATE students SET deleted_at = datetime('now')
              WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(payload.id);
        logActivity(db, actor.userId, 'students.softDelete', `student:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] students:softDelete error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:restore',
    (event, payload: { id: number; actorId?: number }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        const res = db
          .prepare(`UPDATE students SET deleted_at = NULL WHERE id = ?`)
          .run(payload.id);
        logActivity(db, actor.userId, 'students.restore', `student:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        console.error('[ipc] students:restore error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  // ---- student grades (내신) --------------------------------------------
  ipcMain.handle('students:listGrades', (_e, studentId: number) => {
    const db = getDb();
    return db
      .prepare(
        `SELECT g.id, g.student_id, g.grade_level, g.semester, g.subject,
                g.score, g.raw_score, g.memo,
                g.created_by, g.created_at, g.updated_at,
                u.name AS created_by_name
           FROM student_grades g
           LEFT JOIN users u ON u.id = g.created_by
          WHERE g.student_id = ?
          ORDER BY g.grade_level DESC, g.semester DESC, g.subject ASC`,
      )
      .all(studentId);
  });

  ipcMain.handle(
    'students:upsertGrade',
    (
      event,
      payload: {
        id?: number;
        studentId: number;
        gradeLevel: string;
        semester: string;
        subject: string;
        score?: string | null;
        rawScore?: number | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        if (!payload.gradeLevel?.trim() || !payload.semester?.trim() || !payload.subject?.trim()) {
          return { ok: false, error: 'missing_key' };
        }
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE student_grades
                  SET grade_level = ?, semester = ?, subject = ?,
                      score = ?, raw_score = ?, memo = ?,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .run(
              payload.gradeLevel.trim(),
              payload.semester.trim(),
              payload.subject.trim(),
              payload.score ?? null,
              payload.rawScore ?? null,
              payload.memo ?? null,
              payload.id,
            );
          logActivity(db, actor.userId, 'students.updateGrade', `grade:${payload.id}`, {
            studentId: payload.studentId,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        // insert with ON CONFLICT → treat as update on UNIQUE violation
        try {
          const info = db
            .prepare(
              `INSERT INTO student_grades (
                 student_id, grade_level, semester, subject,
                 score, raw_score, memo, created_by
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              payload.studentId,
              payload.gradeLevel.trim(),
              payload.semester.trim(),
              payload.subject.trim(),
              payload.score ?? null,
              payload.rawScore ?? null,
              payload.memo ?? null,
              actor.userId,
            );
          logActivity(db, actor.userId, 'students.addGrade', `grade:${info.lastInsertRowid}`, {
            studentId: payload.studentId,
          });
          return { ok: true, id: Number(info.lastInsertRowid) };
        } catch (err: unknown) {
          const msg = (err as Error).message ?? '';
          if (msg.includes('UNIQUE')) {
            // fallback: update existing row
            const res = db
              .prepare(
                `UPDATE student_grades
                    SET score = ?, raw_score = ?, memo = ?,
                        updated_at = datetime('now')
                  WHERE student_id = ? AND grade_level = ?
                    AND semester = ? AND subject = ?`,
              )
              .run(
                payload.score ?? null,
                payload.rawScore ?? null,
                payload.memo ?? null,
                payload.studentId,
                payload.gradeLevel.trim(),
                payload.semester.trim(),
                payload.subject.trim(),
              );
            return { ok: res.changes > 0, merged: true };
          }
          throw err;
        }
      } catch (err) {
        console.error('[ipc] students:upsertGrade error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteGrade',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      recordDeletion(db, 'student_grades', payload.id, actor.userId, { reason: payload.reason });
      const res = db.prepare(`DELETE FROM student_grades WHERE id = ?`).run(payload.id);
      logActivity(db, actor.userId, 'students.deleteGrade', `grade:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ---- student counseling logs (상담 이력) ------------------------------
  ipcMain.handle('students:listCounseling', (_e, studentId: number) => {
    const db = getDb();
    return db
      .prepare(
        `SELECT c.id, c.student_id, c.log_date, c.title, c.body, c.category,
                c.created_by, c.created_at, c.updated_at,
                u.name AS created_by_name
           FROM student_counseling_logs c
           LEFT JOIN users u ON u.id = c.created_by
          WHERE c.student_id = ?
          ORDER BY c.log_date DESC, c.id DESC
          LIMIT 500`,
      )
      .all(studentId);
  });

  ipcMain.handle(
    'students:upsertCounseling',
    (
      event,
      payload: {
        id?: number;
        studentId: number;
        logDate: string;
        title: string;
        body?: string | null;
        category?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        const title = payload.title?.trim();
        const logDate = payload.logDate?.trim();
        if (!title) return { ok: false, error: 'title_required' };
        if (!logDate) return { ok: false, error: 'log_date_required' };
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE student_counseling_logs
                  SET log_date = ?, title = ?, body = ?, category = ?,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .run(logDate, title, payload.body ?? null, payload.category ?? null, payload.id);
          logActivity(db, actor.userId, 'students.updateCounseling', `counseling:${payload.id}`, {
            studentId: payload.studentId,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        const info = db
          .prepare(
            `INSERT INTO student_counseling_logs (
               student_id, log_date, title, body, category, created_by
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.studentId,
            logDate,
            title,
            payload.body ?? null,
            payload.category ?? null,
            actor.userId,
          );
        logActivity(db, actor.userId, 'students.addCounseling', `counseling:${info.lastInsertRowid}`, {
          studentId: payload.studentId,
        });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        console.error('[ipc] students:upsertCounseling error', err);
        return { ok: false, error: (err as Error).message || 'server_error' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteCounseling',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      recordDeletion(db, 'student_counseling_logs', payload.id, actor.userId, {
        reason: payload.reason,
      });
      const res = db
        .prepare(`DELETE FROM student_counseling_logs WHERE id = ?`)
        .run(payload.id);
      logActivity(db, actor.userId, 'students.deleteCounseling', `counseling:${payload.id}`, {});
      return { ok: res.changes > 0 };
    },
  );

  // ---- combined history: assignments + parsing_results ------------------
  ipcMain.handle('students:history', (_e, studentId: number) => {
    const db = getDb();
    const assignments = db
      .prepare(
        `SELECT a.id, a.code, a.title, a.subject, a.publisher, a.scope, a.length_req,
                a.state, a.risk, a.due_at, a.received_at, a.completed_at,
                a.parser_id, a.qa1_id, a.qa_final_id,
                up.name AS parser_name,
                u1.name AS qa1_name,
                u2.name AS qa_final_name,
                (SELECT COUNT(*) FROM parsing_results p WHERE p.assignment_id = a.id) AS parsing_count
           FROM assignments a
           LEFT JOIN users up ON up.id = a.parser_id
           LEFT JOIN users u1 ON u1.id = a.qa1_id
           LEFT JOIN users u2 ON u2.id = a.qa_final_id
          WHERE a.student_id = ?
          ORDER BY COALESCE(a.received_at, a.created_at) DESC
          LIMIT 300`,
      )
      .all(studentId);

    const parsings = db
      .prepare(
        `SELECT p.id, p.assignment_id, p.version, p.ai_summary, p.confidence,
                p.parsed_at, p.parsed_by,
                u.name AS parser_name,
                a.code AS assignment_code,
                a.title AS assignment_title,
                a.subject AS assignment_subject
           FROM parsing_results p
           JOIN assignments a ON a.id = p.assignment_id
           LEFT JOIN users u ON u.id = p.parsed_by
          WHERE a.student_id = ?
          ORDER BY p.parsed_at DESC
          LIMIT 300`,
      )
      .all(studentId);

    return { assignments, parsings };
  });

  // ---- parsing result detail (for modal view) ----------------------------
  ipcMain.handle('students:getParsingDetail', (_e, parsingId: number) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT p.id, p.assignment_id, p.version, p.content_json, p.ai_summary,
                p.confidence, p.parsed_at, p.parsed_by,
                u.name AS parser_name,
                a.code AS assignment_code,
                a.title AS assignment_title,
                a.subject AS assignment_subject,
                a.publisher AS assignment_publisher
           FROM parsing_results p
           JOIN assignments a ON a.id = p.assignment_id
           LEFT JOIN users u ON u.id = p.parsed_by
          WHERE p.id = ?`,
      )
      .get(parsingId);
    return row ?? null;
  });

  // ---- report topics -----------------------------------------------------
  ipcMain.handle('students:listReportTopics', (_e, studentId: number) => {
    const db = getDb();
    return db
      .prepare(
        `SELECT t.id, t.student_id, t.title, t.subject, t.topic, t.status,
                t.assignment_id, t.due_at, t.submitted_at, t.score, t.memo,
                t.created_by, t.created_at, t.updated_at,
                a.code AS assignment_code,
                u.name AS created_by_name,
                (SELECT COUNT(*) FROM student_archive_files f WHERE f.topic_id = t.id) AS file_count
           FROM student_report_topics t
           LEFT JOIN assignments a ON a.id = t.assignment_id
           LEFT JOIN users u ON u.id = t.created_by
          WHERE t.student_id = ?
          ORDER BY COALESCE(t.due_at, t.created_at) DESC, t.id DESC
          LIMIT 500`,
      )
      .all(studentId);
  });

  ipcMain.handle(
    'students:upsertReportTopic',
    (
      event,
      payload: {
        id?: number;
        studentId: number;
        title: string;
        subject?: string;
        topic?: string;
        status?: string;
        assignmentId?: number | null;
        dueAt?: string | null;
        submittedAt?: string | null;
        score?: string | null;
        memo?: string | null;
        actorId?: number;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        const title = payload.title?.trim();
        if (!title) return { ok: false, error: 'title_required' };
        const status = payload.status ?? 'planned';
        if (payload.id) {
          const res = db
            .prepare(
              `UPDATE student_report_topics
                  SET title = ?, subject = ?, topic = ?, status = ?,
                      assignment_id = ?, due_at = ?, submitted_at = ?,
                      score = ?, memo = ?,
                      updated_at = datetime('now')
                WHERE id = ?`,
            )
            .run(
              title,
              payload.subject ?? null,
              payload.topic ?? null,
              status,
              payload.assignmentId ?? null,
              payload.dueAt ?? null,
              payload.submittedAt ?? null,
              payload.score ?? null,
              payload.memo ?? null,
              payload.id,
            );
          logActivity(db, actor.userId, 'students.updateReportTopic', `topic:${payload.id}`, {
            studentId: payload.studentId,
            title,
          });
          return { ok: res.changes > 0, id: payload.id };
        }
        const info = db
          .prepare(
            `INSERT INTO student_report_topics (
                student_id, title, subject, topic, status,
                assignment_id, due_at, submitted_at, score, memo, created_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.studentId,
            title,
            payload.subject ?? null,
            payload.topic ?? null,
            status,
            payload.assignmentId ?? null,
            payload.dueAt ?? null,
            payload.submittedAt ?? null,
            payload.score ?? null,
            payload.memo ?? null,
            actor.userId,
          );
        logActivity(
          db,
          actor.userId,
          'students.createReportTopic',
          `topic:${info.lastInsertRowid}`,
          { studentId: payload.studentId, title },
        );
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'upsert_failed' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteReportTopic',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        recordDeletion(db, 'student_report_topics', payload.id, actor.userId, {
          reason: payload.reason,
        });
        const res = db
          .prepare(`DELETE FROM student_report_topics WHERE id = ?`)
          .run(payload.id);
        logActivity(db, actor.userId, 'students.deleteReportTopic', `topic:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  // ---- archive files -----------------------------------------------------
  ipcMain.handle(
    'students:listArchiveFiles',
    (_e, filter: { studentId: number; topicId?: number | null }) => {
      const db = getDb();
      const where: string[] = ['f.student_id = ?'];
      const params: unknown[] = [filter.studentId];
      if (typeof filter.topicId === 'number') {
        where.push('f.topic_id = ?');
        params.push(filter.topicId);
      }
      return db
        .prepare(
          `SELECT f.id, f.student_id, f.topic_id, f.category,
                  f.original_name, f.stored_path, f.mime_type, f.size_bytes,
                  f.description, f.uploaded_at, f.uploaded_by,
                  f.source_assignment_id, f.auto_generated,
                  u.name AS uploader_name,
                  t.title AS topic_title,
                  a.code AS source_assignment_code,
                  a.title AS source_assignment_title,
                  a.state AS source_assignment_state
             FROM student_archive_files f
             LEFT JOIN users u ON u.id = f.uploaded_by
             LEFT JOIN student_report_topics t ON t.id = f.topic_id
             LEFT JOIN assignments a ON a.id = f.source_assignment_id
            WHERE ${where.join(' AND ')}
            ORDER BY f.uploaded_at DESC
            LIMIT 500`,
        )
        .all(...params);
    },
  );

  ipcMain.handle(
    'students:addArchiveFile',
    (
      _e,
      payload: {
        studentId: number;
        topicId?: number | null;
        category?: string;
        originalName: string;
        storedPath?: string;
        mimeType?: string;
        sizeBytes?: number;
        description?: string | null;
        uploaderId: number;
      },
    ) => {
      const db = getDb();
      try {
        const name = payload.originalName?.trim();
        if (!name) return { ok: false, error: 'name_required' };
        const category = payload.category ?? 'report';
        const storedPath = payload.storedPath ?? `local://${name}`;
        const info = db
          .prepare(
            `INSERT INTO student_archive_files (
                student_id, topic_id, category, original_name, stored_path,
                mime_type, size_bytes, description,
                source_assignment_id, auto_generated,
                uploaded_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
          )
          .run(
            payload.studentId,
            payload.topicId ?? null,
            category,
            name,
            storedPath,
            payload.mimeType ?? null,
            payload.sizeBytes ?? null,
            payload.description ?? null,
            payload.uploaderId,
          );
        logActivity(
          db,
          payload.uploaderId,
          'students.addArchiveFile',
          `archiveFile:${info.lastInsertRowid}`,
          { studentId: payload.studentId, name, category },
        );
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'add_failed' };
      }
    },
  );

  ipcMain.handle(
    'students:deleteArchiveFile',
    (event, payload: { id: number; actorId?: number; reason?: string }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      try {
        // Auto-generated rows are managed by syncAssignmentArchive — don't let
        // manual deletes orphan them. If the user truly wants to remove such a
        // row, they should revert the underlying assignment state instead.
        const existing = db
          .prepare(
            `SELECT auto_generated FROM student_archive_files WHERE id = ?`,
          )
          .get(payload.id) as { auto_generated: number } | undefined;
        if (!existing) return { ok: false, error: 'not_found' };
        if (existing.auto_generated) {
          return { ok: false, error: 'auto_generated_readonly' };
        }
        recordDeletion(db, 'student_archive_files', payload.id, actor.userId, {
          reason: payload.reason,
        });
        const res = db
          .prepare(`DELETE FROM student_archive_files WHERE id = ?`)
          .run(payload.id);
        logActivity(db, actor.userId, 'students.deleteArchiveFile', `archiveFile:${payload.id}`, {});
        return { ok: res.changes > 0 };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'delete_failed' };
      }
    },
  );

  // =======================================================================
  // Notion 연동 (수동 트리거 동기화)
  // =======================================================================

  ipcMain.handle('notion:getSettings', () => {
    // 토큰은 민감 정보이므로 전체 노출 대신 isConfigured 플래그 + 마스킹만 반환.
    const s = NotionSync.getSettings();
    const masked =
      s.token && s.token.length > 8
        ? `${s.token.slice(0, 4)}…${s.token.slice(-4)}`
        : s.token
          ? '••••'
          : '';
    return {
      isConfigured: Boolean(s.token),
      tokenMasked: masked,
      studentDatabases: s.studentDatabases,
      assignmentDatabases: s.assignmentDatabases,
    };
  });

  ipcMain.handle(
    'notion:saveSettings',
    (
      event,
      payload: {
        token?: string;
        studentDatabases?: NotionSettings['studentDatabases'];
        assignmentDatabases?: NotionSettings['assignmentDatabases'];
        actorId?: number | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.hrAdmin);
      try {
        const patch: Partial<NotionSettings> = {};
        if (payload.token !== undefined) patch.token = payload.token.trim();
        if (payload.studentDatabases !== undefined) {
          patch.studentDatabases = payload.studentDatabases;
        }
        if (payload.assignmentDatabases !== undefined) {
          patch.assignmentDatabases = payload.assignmentDatabases;
        }
        const saved = NotionSync.saveSettings(patch);
        logActivity(getDb(), actor.userId, 'notion.saveSettings', 'notion:settings', {
          tokenChanged: payload.token !== undefined,
          dbsChanged: payload.studentDatabases !== undefined,
          asgDbsChanged: payload.assignmentDatabases !== undefined,
          dbCount: saved.studentDatabases.length,
          asgDbCount: saved.assignmentDatabases.length,
        });
        return {
          ok: true,
          studentDatabases: saved.studentDatabases,
          assignmentDatabases: saved.assignmentDatabases,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? 'save_failed' };
      }
    },
  );

  ipcMain.handle('notion:probe', async (_e, payload?: { actorId?: number | null }) => {
    return NotionSync.probe(payload?.actorId ?? null);
  });

  ipcMain.handle(
    'notion:syncStudents',
    async (_e, payload?: { actorId?: number | null }) => {
      return NotionSync.syncStudents(payload?.actorId ?? null);
    },
  );

  ipcMain.handle(
    'notion:syncStaff',
    async (_e, payload?: { actorId?: number | null }) => {
      return NotionSync.syncStaff(payload?.actorId ?? null);
    },
  );

  ipcMain.handle(
    'notion:syncAssignments',
    async (_e, payload?: { actorId?: number | null }) => {
      return NotionSync.syncAssignments(payload?.actorId ?? null);
    },
  );

  ipcMain.handle(
    'notion:listRuns',
    (
      _e,
      filter?: {
        limit?: number;
        kind?: 'students' | 'staff' | 'probe' | 'assignments';
      },
    ) => {
      return NotionSync.listRuns({ limit: filter?.limit, kind: filter?.kind });
    },
  );
}

// ===========================================================================
// In-app release trigger (leadership only).
//
//   release:getConfig   → whether a PAT is stored + current repo/workflow
//   release:setConfig   → save PAT (safeStorage-encrypted) + repo overrides
//   release:clearConfig → wipe PAT
//   release:trigger     → POST GitHub Actions workflow_dispatch
//   release:listRuns    → poll recent workflow runs
//
// The PAT is stored base64-encrypted via Electron's safeStorage (OS keychain
// where available) in admin_settings under the key `release.config.v1`. It
// is NEVER returned to the renderer — only `{ hasPat: true }`.
// ===========================================================================

type ReleaseConfigStored = {
  repoOwner: string;
  repoName: string;
  workflowFile: string;
  patCipherBase64?: string;
};

const RELEASE_SETTING_KEY = 'release.config.v1';
const RELEASE_DEFAULT: ReleaseConfigStored = {
  repoOwner: '42Jason',
  repoName: 'injaewon-eduops-portal',
  workflowFile: 'release-bump.yml',
};

function readReleaseConfig(): ReleaseConfigStored {
  const db = getDb();
  const row = db
    .prepare(`SELECT value_json FROM admin_settings WHERE key = ?`)
    .get(RELEASE_SETTING_KEY) as { value_json: string } | undefined;
  if (!row) return { ...RELEASE_DEFAULT };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<ReleaseConfigStored>;
    return {
      repoOwner: parsed.repoOwner ?? RELEASE_DEFAULT.repoOwner,
      repoName: parsed.repoName ?? RELEASE_DEFAULT.repoName,
      workflowFile: parsed.workflowFile ?? RELEASE_DEFAULT.workflowFile,
      patCipherBase64: parsed.patCipherBase64,
    };
  } catch {
    return { ...RELEASE_DEFAULT };
  }
}

function writeReleaseConfig(cfg: ReleaseConfigStored) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(RELEASE_SETTING_KEY, JSON.stringify(cfg));
}

function decryptPat(cfg: ReleaseConfigStored): string | null {
  if (!cfg.patCipherBase64) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = Buffer.from(cfg.patCipherBase64, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn('[ipc] release PAT decrypt failed', err);
    return null;
  }
}

function registerReleaseIpc(appVersion: string) {
  ipcMain.handle('release:getConfig', (event) => {
    requireRole(event, ROLE_SETS.leadership);
    const cfg = readReleaseConfig();
    return {
      ok: true as const,
      hasPat: Boolean(cfg.patCipherBase64),
      repoOwner: cfg.repoOwner,
      repoName: cfg.repoName,
      workflowFile: cfg.workflowFile,
      currentVersion: appVersion,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  });

  ipcMain.handle(
    'release:setConfig',
    (
      event,
      payload: {
        pat?: string | null;
        repoOwner?: string;
        repoName?: string;
        workflowFile?: string;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.leadership);
      const db = getDb();
      const current = readReleaseConfig();
      const next: ReleaseConfigStored = {
        repoOwner: payload.repoOwner?.trim() || current.repoOwner,
        repoName: payload.repoName?.trim() || current.repoName,
        workflowFile: payload.workflowFile?.trim() || current.workflowFile,
        patCipherBase64: current.patCipherBase64,
      };
      if (typeof payload.pat === 'string') {
        const trimmed = payload.pat.trim();
        if (trimmed.length === 0) {
          // empty string → clear PAT
          next.patCipherBase64 = undefined;
        } else {
          if (!safeStorage.isEncryptionAvailable()) {
            return { ok: false as const, error: 'safe_storage_unavailable' };
          }
          const cipher = safeStorage.encryptString(trimmed);
          next.patCipherBase64 = cipher.toString('base64');
        }
      }
      writeReleaseConfig(next);
      logActivity(db, actor.userId, 'release.configSet', 'release:config', {
        patChanged: typeof payload.pat === 'string',
        repoOwner: next.repoOwner,
        repoName: next.repoName,
        workflowFile: next.workflowFile,
      });
      return { ok: true as const };
    },
  );

  ipcMain.handle('release:clearConfig', (event) => {
    const actor = requireRole(event, ROLE_SETS.leadership);
    const db = getDb();
    const current = readReleaseConfig();
    writeReleaseConfig({
      repoOwner: current.repoOwner,
      repoName: current.repoName,
      workflowFile: current.workflowFile,
      patCipherBase64: undefined,
    });
    logActivity(db, actor.userId, 'release.configClear', 'release:config', {});
    return { ok: true as const };
  });

  ipcMain.handle(
    'release:trigger',
    async (
      event,
      payload: {
        bumpType: 'patch' | 'minor' | 'major';
        customVersion?: string | null;
        notes?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.leadership);
      const db = getDb();
      const cfg = readReleaseConfig();
      const pat = decryptPat(cfg);
      if (!pat) {
        return { ok: false as const, error: 'pat_missing' };
      }
      const url = `https://api.github.com/repos/${encodeURIComponent(cfg.repoOwner)}/${encodeURIComponent(cfg.repoName)}/actions/workflows/${encodeURIComponent(cfg.workflowFile)}/dispatches`;
      const body = {
        ref: 'main',
        inputs: {
          bump_type: payload.bumpType,
          custom_version: payload.customVersion?.trim() ?? '',
          notes: payload.notes?.trim() ?? '',
        },
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${pat}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'EduOps-Portal-Release-Trigger',
          },
          body: JSON.stringify(body),
        });
        if (res.status === 204) {
          logActivity(db, actor.userId, 'release.triggered', 'release:bump', {
            bumpType: payload.bumpType,
            customVersion: payload.customVersion ?? null,
            notes: payload.notes ?? null,
          });
          return { ok: true as const };
        }
        const text = await res.text();
        return {
          ok: false as const,
          error: `github_${res.status}`,
          detail: text.slice(0, 500),
        };
      } catch (err) {
        return {
          ok: false as const,
          error: 'network_error',
          detail: (err as Error).message ?? String(err),
        };
      }
    },
  );

  ipcMain.handle('release:listRuns', async (event, payload?: { limit?: number }) => {
    requireRole(event, ROLE_SETS.leadership);
    const cfg = readReleaseConfig();
    const pat = decryptPat(cfg);
    if (!pat) {
      return { ok: false as const, error: 'pat_missing' };
    }
    const limit = Math.max(1, Math.min(20, payload?.limit ?? 10));
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.repoOwner)}/${encodeURIComponent(cfg.repoName)}/actions/runs?per_page=${limit}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${pat}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'EduOps-Portal-Release-Trigger',
        },
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false as const,
          error: `github_${res.status}`,
          detail: text.slice(0, 500),
        };
      }
      const json = (await res.json()) as {
        workflow_runs?: Array<{
          id: number;
          name?: string | null;
          display_title?: string | null;
          head_branch?: string | null;
          head_sha?: string | null;
          status?: string | null;
          conclusion?: string | null;
          event?: string | null;
          html_url?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          path?: string | null;
        }>;
      };
      const runs = (json.workflow_runs ?? []).map((r) => ({
        id: r.id,
        name: r.name ?? '',
        title: r.display_title ?? '',
        branch: r.head_branch ?? '',
        sha: (r.head_sha ?? '').slice(0, 7),
        status: r.status ?? '',
        conclusion: r.conclusion ?? '',
        event: r.event ?? '',
        url: r.html_url ?? '',
        createdAt: r.created_at ?? '',
        updatedAt: r.updated_at ?? '',
        path: r.path ?? '',
      }));
      return { ok: true as const, runs };
    } catch (err) {
      return {
        ok: false as const,
        error: 'network_error',
        detail: (err as Error).message ?? String(err),
      };
    }
  });
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

// ===========================================================================
// 휴지통 (deleted_records) 헬퍼 — v0.1.15
// ===========================================================================
// 모든 hard-DELETE / soft-delete 직전에 호출해 원본 row 를 JSON 으로 박제한다.
// 복원은 이 JSON 을 원본 테이블에 INSERT 하면 끝 (id 컬럼은 제외 또는 유지).
//
// 인자:
//   table : 원본 테이블 이름 (사용자 UI 에 그대로 노출하지 않음)
//   id    : 원본 row 의 id (복원 성공 여부 추적/activity 용)
//   actorId: 삭제를 유발한 사용자 (null 허용)
//   opts.category : UI 탭 분류
//   opts.label    : 사용자에게 보여줄 짧은 이름 (과제 코드, 업무일지 요약 등)
//   opts.reason   : 사용자가 남긴 메모
//
// 구현 디테일:
//   1) `SELECT * FROM <table> WHERE id = ?` 로 row 를 읽어 JSON 화.
//   2) row 가 이미 없으면 ("먼저 삭제됨") 조용히 리턴해 bulk 삭제의 경쟁조건을
//      죽이지 않는다.
//   3) 이 함수 자체는 DELETE 를 하지 않는다 — 호출 측이 기존대로 DELETE/UPDATE.
// ===========================================================================
const TABLE_CATEGORY: Record<string, string> = {
  assignments: 'operations',
  students: 'students',
  student_grades: 'students',
  student_counseling_logs: 'students',
  student_report_topics: 'students',
  student_archive_files: 'students',
  cs_tickets: 'cs',
  recurring_subscriptions: 'admin',
  corporate_card_transactions: 'admin',
  manual_pages: 'knowledge',
  notices: 'knowledge',
  work_logs: 'org',
  leave_requests: 'org',
  approvals: 'org',
  users: 'org',
  parsed_excel_uploads: 'parsing',
};

// 각 테이블에서 복원 시 UI 에 보여줄 라벨을 뽑는 필드 우선순위.
// 예: assignments 는 code, students 는 name, work_logs 는 summary 등.
const TABLE_LABEL_FIELDS: Record<string, string[]> = {
  assignments: ['code', 'title'],
  students: ['name', 'student_code'],
  student_grades: ['subject', 'semester'],
  student_counseling_logs: ['title', 'log_date'],
  student_report_topics: ['topic', 'subject'],
  student_archive_files: ['original_name', 'stored_name'],
  cs_tickets: ['code', 'subject'],
  recurring_subscriptions: ['vendor', 'product'],
  corporate_card_transactions: ['merchant', 'memo'],
  manual_pages: ['title', 'slug'],
  notices: ['title'],
  work_logs: ['summary', 'log_date'],
  leave_requests: ['kind', 'start_date'],
  approvals: ['code', 'title'],
  users: ['name', 'email'],
  parsed_excel_uploads: ['original_name', 'note'],
};

function pickLabel(table: string, row: Record<string, unknown>): string {
  const fields = TABLE_LABEL_FIELDS[table] ?? [];
  for (const f of fields) {
    const v = row[f];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  // fallback — 아무 텍스트 값이든
  for (const [, v] of Object.entries(row)) {
    if (typeof v === 'string' && v.trim() && v.length < 120) return v;
  }
  return `#${row.id ?? '?'}`;
}

function recordDeletion(
  db: ReturnType<typeof getDb>,
  table: string,
  id: number,
  actorId: number | null,
  opts?: { reason?: string | null; label?: string | null; category?: string | null },
): boolean {
  try {
    // PRAGMA 로 컬럼 검증은 생략 — table 명은 코드 상수이므로 SQL 인젝션 위험 없음.
    const row = db
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return false; // 이미 없는 행 — 조용히 넘어간다.

    const category = opts?.category ?? TABLE_CATEGORY[table] ?? 'other';
    const label = opts?.label ?? pickLabel(table, row);

    db.prepare(
      `INSERT INTO deleted_records
         (table_name, row_id, category, label, payload_json, reason, deleted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      table,
      id,
      category,
      label,
      JSON.stringify(row),
      opts?.reason ?? null,
      actorId,
    );
    return true;
  } catch (err) {
    // tombstone 실패가 본 DELETE 를 막게 하진 않는다 — 로그만 남긴다.
    console.warn(`[ipc] recordDeletion(${table}#${id}) failed:`, err);
    return false;
  }
}

/**
 * Sync the student archive with an assignment's current state.
 *
 * - `승인완료` (final approval) → ensure one auto-generated archive row exists
 *   for this assignment. Re-approvals are idempotent (no duplicate rows).
 * - Any other state → remove any auto-generated archive rows for this
 *   assignment. This covers the rejection flow: an assignment that was
 *   briefly 승인완료 then flipped back (e.g. 최종QA반려, 수정요청) gets pulled
 *   out of the archive automatically.
 *
 * Manually uploaded rows (`auto_generated = 0`) are never touched — if a
 * teacher hand-archived a file, we don't revoke it.
 *
 * Safe to call inside the caller's transaction — every statement here is
 * narrow and idempotent.
 */
function syncAssignmentArchive(
  db: ReturnType<typeof getDb>,
  assignmentId: number,
  newState: string,
  actorId: number | null,
) {
  try {
    interface AssignmentRow {
      id: number;
      code: string;
      title: string;
      subject: string | null;
      publisher: string | null;
      student_id: number | null;
    }
    const row = db
      .prepare(
        `SELECT id, code, title, subject, publisher, student_id
           FROM assignments
          WHERE id = ?`,
      )
      .get(assignmentId) as AssignmentRow | undefined;
    if (!row) return;

    if (newState === '승인완료') {
      // No student linkage → can't archive to a specific student.
      if (!row.student_id) return;

      const existing = db
        .prepare(
          `SELECT id FROM student_archive_files
            WHERE source_assignment_id = ? AND auto_generated = 1
            LIMIT 1`,
        )
        .get(assignmentId) as { id: number } | undefined;
      if (existing) return; // already archived

      const descParts: string[] = [];
      if (row.subject) descParts.push(row.subject);
      if (row.publisher) descParts.push(row.publisher);
      descParts.push(`과제코드 ${row.code}`);
      const description = `[자동] 최종 승인된 과제 · ${descParts.join(' · ')}`;
      const originalName = `${row.code} ${row.title}`.slice(0, 240);

      const info = db
        .prepare(
          `INSERT INTO student_archive_files (
              student_id, topic_id, category, original_name, stored_path,
              mime_type, size_bytes, description,
              source_assignment_id, auto_generated,
              uploaded_by
           ) VALUES (?, NULL, 'report', ?, ?, NULL, NULL, ?, ?, 1, ?)`,
        )
        .run(
          row.student_id,
          originalName,
          `assignment://${row.id}`,
          description,
          assignmentId,
          actorId,
        );

      logActivity(db, actorId, 'students.autoArchive', `archiveFile:${info.lastInsertRowid}`, {
        assignmentId,
        studentId: row.student_id,
        code: row.code,
      });
    } else {
      // Rolling back an earlier final approval — yank any auto-archived rows.
      const removedRows = db
        .prepare(
          `SELECT id FROM student_archive_files
            WHERE source_assignment_id = ? AND auto_generated = 1`,
        )
        .all(assignmentId) as Array<{ id: number }>;
      if (removedRows.length === 0) return;

      const res = db
        .prepare(
          `DELETE FROM student_archive_files
            WHERE source_assignment_id = ? AND auto_generated = 1`,
        )
        .run(assignmentId);

      if (res.changes > 0) {
        logActivity(db, actorId, 'students.autoUnarchive', `assignment:${assignmentId}`, {
          assignmentId,
          newState,
          removed: removedRows.map((r) => r.id),
        });
      }
    }
  } catch (err) {
    console.warn('[ipc] syncAssignmentArchive failed', err);
  }
}

// ===========================================================================
// Parsing uploads (조교 업로드 → 정규직 소비)
//   - uploadExcel: 조교(TA)/파싱팀/리더십이 파싱한 엑셀을 업로드.
//                  <userData>/parsed-excel-uploads/<id>-<sanitized>.xlsx 로 저장.
//   - list: 상태별 조회. 조교는 본인 업로드만, 정규직은 전체.
//   - download: 파일 바이너리 반환. 정규직 소비자 한정.
//   - markConsumed: 소비 완료 표시 + 로그. 정규직 소비자 한정.
//   - deleteUpload: 업로드 취소. 조교는 본인 pending 건만, 리더십은 언제든.
// ===========================================================================

interface ParsedUploadRow {
  id: number;
  uploader_user_id: number | null;
  original_name: string;
  stored_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  student_code: string | null;
  subject: string | null;
  title: string | null;
  status: 'pending' | 'consumed' | 'archived';
  consumed_by_user_id: number | null;
  consumed_at: string | null;
  consumed_note: string | null;
  uploaded_at: string;
  uploader_name: string | null;
  consumer_name: string | null;
}

function parsingUploadsDir(): string {
  const dir = path.join(app.getPath('userData'), 'parsed-excel-uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeUploadName(name: string): string {
  // 파일시스템에서 위험한 문자 제거 — Windows 기준으로 보수적으로.
  // 조교가 한글 파일명을 업로드해도 그대로 살리되 구분자/제어문자만 제거.
  const trimmed = (name ?? 'upload.xlsx').trim() || 'upload.xlsx';
  return trimmed.replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 180);
}

function registerParsingUploadsIpc() {
  // -- upload ---------------------------------------------------------------
  ipcMain.handle(
    'parsing:uploadExcel',
    (
      event,
      payload: {
        filename: string;
        buffer: ArrayBuffer | Uint8Array;
        mimeType?: string | null;
        note?: string | null;
        studentCode?: string | null;
        subject?: string | null;
        title?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parsingUploader);
      const db = getDb();
      try {
        const original = (payload.filename ?? '').trim() || 'upload.xlsx';
        const buf =
          payload.buffer instanceof Uint8Array
            ? Buffer.from(payload.buffer)
            : Buffer.from(new Uint8Array(payload.buffer));
        if (buf.length === 0) return { ok: false as const, error: 'empty_file' };
        // 30MB 초과는 반려 (엑셀 파싱 결과로는 충분)
        if (buf.length > 30 * 1024 * 1024) {
          return { ok: false as const, error: 'file_too_large' };
        }

        // 미리 row 를 생성해서 id 를 받은 뒤 파일명을 id 로 고유화.
        const insert = db.prepare(
          `INSERT INTO parsed_excel_uploads
             (uploader_user_id, original_name, stored_path, mime_type, size_bytes,
              note, student_code, subject, title, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        );
        // stored_path 는 id 기준으로 뒤에 UPDATE — 그래서 일단 빈 값 삽입.
        const info = insert.run(
          actor.userId,
          original,
          '',
          payload.mimeType ?? null,
          buf.length,
          (payload.note ?? '').trim() || null,
          (payload.studentCode ?? '').trim() || null,
          (payload.subject ?? '').trim() || null,
          (payload.title ?? '').trim() || null,
        );
        const id = Number(info.lastInsertRowid);

        const sanitized = sanitizeUploadName(original);
        const storedRel = path.join('parsed-excel-uploads', `${id}-${sanitized}`);
        const storedAbs = path.join(app.getPath('userData'), storedRel);
        try {
          fs.mkdirSync(path.dirname(storedAbs), { recursive: true });
          fs.writeFileSync(storedAbs, buf);
        } catch (writeErr) {
          // 파일 쓰기 실패 — row 롤백.
          db.prepare(`DELETE FROM parsed_excel_uploads WHERE id = ?`).run(id);
          throw writeErr;
        }
        db.prepare(
          `UPDATE parsed_excel_uploads SET stored_path = ? WHERE id = ?`,
        ).run(storedRel, id);

        logActivity(db, actor.userId, 'parsing.upload', `parsedUpload:${id}`, {
          name: original,
          size: buf.length,
          studentCode: payload.studentCode ?? null,
        });

        return { ok: true as const, id, storedPath: storedRel };
      } catch (err) {
        console.error('[ipc] parsing:uploadExcel error', err);
        return { ok: false as const, error: (err as Error).message ?? 'upload_failed' };
      }
    },
  );

  // -- list -----------------------------------------------------------------
  ipcMain.handle(
    'parsing:listUploads',
    (
      event,
      filter?: {
        status?: 'pending' | 'consumed' | 'archived' | 'all';
        mineOnly?: boolean;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.parsingUploader);
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      // 조교는 항상 본인 업로드만 본다 (정규직/리더십은 전체 + 옵션).
      const isConsumer = (ROLE_SETS.parsingConsumer as readonly string[]).includes(
        actor.role,
      );
      if (!isConsumer || filter?.mineOnly) {
        where.push('u.uploader_user_id = ?');
        params.push(actor.userId);
      }
      if (filter?.status && filter.status !== 'all') {
        where.push('u.status = ?');
        params.push(filter.status);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT u.id, u.uploader_user_id, u.original_name, u.stored_path,
                  u.mime_type, u.size_bytes, u.note, u.student_code,
                  u.subject, u.title, u.status,
                  u.consumed_by_user_id, u.consumed_at, u.consumed_note, u.uploaded_at,
                  up.name AS uploader_name,
                  cu.name AS consumer_name
             FROM parsed_excel_uploads u
             LEFT JOIN users up ON up.id = u.uploader_user_id
             LEFT JOIN users cu ON cu.id = u.consumed_by_user_id
             ${whereSql}
             ORDER BY u.uploaded_at DESC
             LIMIT 500`,
        )
        .all(...params) as ParsedUploadRow[];
      return rows;
    },
  );

  // -- download (binary) ----------------------------------------------------
  ipcMain.handle(
    'parsing:downloadUpload',
    (event, payload: { id: number }) => {
      // 조교는 본인 업로드 다운로드만 허용. 정규직/리더십은 모두.
      const actor = requireActor(event);
      const db = getDb();
      const row = db
        .prepare(
          `SELECT id, uploader_user_id, original_name, stored_path, mime_type, size_bytes
             FROM parsed_excel_uploads WHERE id = ?`,
        )
        .get(payload.id) as
        | Pick<
            ParsedUploadRow,
            'id' | 'uploader_user_id' | 'original_name' | 'stored_path' | 'mime_type' | 'size_bytes'
          >
        | undefined;
      if (!row) return { ok: false as const, error: 'not_found' };
      const isConsumer = (ROLE_SETS.parsingConsumer as readonly string[]).includes(
        actor.role,
      );
      if (!isConsumer && row.uploader_user_id !== actor.userId) {
        throw new AuthError('forbidden');
      }
      try {
        const abs = path.join(app.getPath('userData'), row.stored_path);
        const data = fs.readFileSync(abs);
        return {
          ok: true as const,
          filename: row.original_name,
          mimeType: row.mime_type ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: row.size_bytes ?? data.length,
          buffer: data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer,
        };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message ?? 'read_failed' };
      }
    },
  );

  // -- open in OS (shell.openPath) -----------------------------------------
  // 정규직이 다운로드 저장 없이 바로 엑셀 앱으로 열어보도록 편의 제공.
  ipcMain.handle(
    'parsing:openUpload',
    async (event, payload: { id: number }) => {
      requireRole(event, ROLE_SETS.parsingConsumer);
      const db = getDb();
      const row = db
        .prepare(`SELECT stored_path FROM parsed_excel_uploads WHERE id = ?`)
        .get(payload.id) as { stored_path: string } | undefined;
      if (!row) return { ok: false as const, error: 'not_found' };
      const abs = path.join(app.getPath('userData'), row.stored_path);
      const result = await shell.openPath(abs);
      if (result) return { ok: false as const, error: result };
      return { ok: true as const };
    },
  );

  // -- mark consumed --------------------------------------------------------
  ipcMain.handle(
    'parsing:markConsumed',
    (event, payload: { id: number; note?: string | null }) => {
      const actor = requireRole(event, ROLE_SETS.parsingConsumer);
      const db = getDb();
      const row = db
        .prepare(`SELECT id, status FROM parsed_excel_uploads WHERE id = ?`)
        .get(payload.id) as { id: number; status: string } | undefined;
      if (!row) return { ok: false as const, error: 'not_found' };
      if (row.status === 'consumed') return { ok: false as const, error: 'already_consumed' };
      db.prepare(
        `UPDATE parsed_excel_uploads
            SET status = 'consumed',
                consumed_by_user_id = ?,
                consumed_at = datetime('now'),
                consumed_note = ?
          WHERE id = ?`,
      ).run(actor.userId, (payload.note ?? '').trim() || null, payload.id);
      logActivity(db, actor.userId, 'parsing.markConsumed', `parsedUpload:${payload.id}`, {
        note: payload.note ?? null,
      });
      return { ok: true as const };
    },
  );

  // -- reopen (되돌리기) ----------------------------------------------------
  ipcMain.handle(
    'parsing:reopenUpload',
    (event, payload: { id: number }) => {
      const actor = requireRole(event, ROLE_SETS.parsingConsumer);
      const db = getDb();
      const res = db
        .prepare(
          `UPDATE parsed_excel_uploads
              SET status = 'pending',
                  consumed_by_user_id = NULL,
                  consumed_at = NULL,
                  consumed_note = NULL
            WHERE id = ? AND status = 'consumed'`,
        )
        .run(payload.id);
      if (res.changes === 0) return { ok: false as const, error: 'not_consumed' };
      logActivity(db, actor.userId, 'parsing.reopen', `parsedUpload:${payload.id}`, {});
      return { ok: true as const };
    },
  );

  // -- delete ---------------------------------------------------------------
  ipcMain.handle(
    'parsing:deleteUpload',
    (event, payload: { id: number; reason?: string }) => {
      const actor = requireActor(event);
      const db = getDb();
      const row = db
        .prepare(
          `SELECT id, uploader_user_id, stored_path, status
             FROM parsed_excel_uploads WHERE id = ?`,
        )
        .get(payload.id) as
        | {
            id: number;
            uploader_user_id: number | null;
            stored_path: string;
            status: string;
          }
        | undefined;
      if (!row) return { ok: false as const, error: 'not_found' };
      const isLeadership = (ROLE_SETS.leadership as readonly string[]).includes(
        actor.role,
      );
      const isOwner = row.uploader_user_id === actor.userId;
      if (!isLeadership && !isOwner) {
        throw new AuthError('forbidden');
      }
      // 본인이더라도 이미 소비된 건은 삭제 금지 (감사 로그 보전).
      if (!isLeadership && row.status === 'consumed') {
        return { ok: false as const, error: 'already_consumed' };
      }
      // 휴지통에 먼저 기록 (파일 unlink 전에 — 복구 시 row 만 살리고 파일은 사용자가 다시 업로드)
      recordDeletion(db, 'parsed_excel_uploads', payload.id, actor.userId, {
        reason: payload.reason,
      });
      try {
        const abs = path.join(app.getPath('userData'), row.stored_path);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (err) {
        console.warn('[ipc] parsing:deleteUpload unlink failed', err);
      }
      db.prepare(`DELETE FROM parsed_excel_uploads WHERE id = ?`).run(payload.id);
      logActivity(db, actor.userId, 'parsing.deleteUpload', `parsedUpload:${payload.id}`, {});
      return { ok: true as const };
    },
  );

  // -- stats (bell-jar summary for the consumer dashboard) ------------------
  ipcMain.handle('parsing:uploadsStats', (event) => {
    const actor = requireActor(event);
    const db = getDb();
    const isConsumer = (ROLE_SETS.parsingConsumer as readonly string[]).includes(
      actor.role,
    );
    const base = isConsumer
      ? `SELECT status, COUNT(*) AS c FROM parsed_excel_uploads GROUP BY status`
      : `SELECT status, COUNT(*) AS c FROM parsed_excel_uploads
           WHERE uploader_user_id = ? GROUP BY status`;
    const rows = isConsumer
      ? (db.prepare(base).all() as Array<{ status: string; c: number }>)
      : (db.prepare(base).all(actor.userId) as Array<{ status: string; c: number }>);
    const stats = { pending: 0, consumed: 0, archived: 0, total: 0 };
    for (const r of rows) {
      if (r.status === 'pending' || r.status === 'consumed' || r.status === 'archived') {
        stats[r.status] = r.c;
        stats.total += r.c;
      }
    }
    return stats;
  });
}

// ===========================================================================
// Trash / Recycle Bin (휴지통)
//   삭제된 레코드를 deleted_records 에 보관하고, 복원/영구삭제/통계를 제공.
//   복원은 payload_json 을 그대로 INSERT — 이미 같은 id 가 살아있으면
//   id 를 비우고 새 PK 로 다시 끼워넣음. 복원 후엔 purged_at 을 기록해
//   리스트에서 사라지게 한다 (감사 로그용으로는 그대로 남는다).
//
//   누가 보나? — opsAdmin (CEO/CTO/운영실장).
// ===========================================================================
function registerTrashIpc() {
  const TRASH_CATEGORY_LABELS: Record<string, string> = {
    operations: '운영보드',
    students: '학생',
    cs: 'CS',
    admin: '행정',
    knowledge: '지식',
    org: '조직',
    parsing: '파싱',
    other: '기타',
  };

  // -- list ----------------------------------------------------------------
  //  필터: { category?: string; tableName?: string; includePurged?: boolean }
  //  반환: 휴지통 row 배열 (payload_json 은 클라이언트 표시용으로 일부 발췌)
  ipcMain.handle(
    'trash:list',
    (
      event,
      filter?: {
        category?: string | null;
        tableName?: string | null;
        includePurged?: boolean;
        search?: string | null;
        limit?: number;
      },
    ) => {
      requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (!filter?.includePurged) where.push('d.purged_at IS NULL');
      if (filter?.category && filter.category !== 'all') {
        where.push('d.category = ?');
        params.push(filter.category);
      }
      if (filter?.tableName) {
        where.push('d.table_name = ?');
        params.push(filter.tableName);
      }
      if (filter?.search) {
        where.push('(d.label LIKE ? OR d.reason LIKE ? OR d.table_name LIKE ?)');
        const like = `%${filter.search.trim()}%`;
        params.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 1000);
      const rows = db
        .prepare(
          `SELECT d.id, d.table_name, d.row_id, d.category, d.label,
                  d.payload_json, d.reason,
                  d.deleted_by, d.deleted_at, d.purged_at,
                  u.name AS deleted_by_name
             FROM deleted_records d
             LEFT JOIN users u ON u.id = d.deleted_by
             ${whereSql}
             ORDER BY d.deleted_at DESC
             LIMIT ?`,
        )
        .all(...params, limit) as Array<{
        id: number;
        table_name: string;
        row_id: number | null;
        category: string;
        label: string | null;
        payload_json: string;
        reason: string | null;
        deleted_by: number | null;
        deleted_at: string;
        purged_at: string | null;
        deleted_by_name: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        tableName: r.table_name,
        rowId: r.row_id,
        category: r.category,
        categoryLabel: TRASH_CATEGORY_LABELS[r.category] ?? r.category,
        label: r.label,
        reason: r.reason,
        deletedBy: r.deleted_by,
        deletedByName: r.deleted_by_name,
        deletedAt: r.deleted_at,
        purgedAt: r.purged_at,
        // payload 는 미리보기용 — 첫 8개 필드만.
        payloadPreview: previewPayload(r.payload_json),
      }));
    },
  );

  // -- stats ---------------------------------------------------------------
  //  카테고리별 활성 휴지통 개수 + 가장 오래된 deleted_at.
  ipcMain.handle('trash:stats', (event) => {
    requireRole(event, ROLE_SETS.opsAdmin);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT category, COUNT(*) AS c, MIN(deleted_at) AS oldest
           FROM deleted_records
          WHERE purged_at IS NULL
          GROUP BY category`,
      )
      .all() as Array<{ category: string; c: number; oldest: string | null }>;
    const total = rows.reduce((acc, r) => acc + r.c, 0);
    return {
      total,
      byCategory: rows.map((r) => ({
        category: r.category,
        categoryLabel: TRASH_CATEGORY_LABELS[r.category] ?? r.category,
        count: r.c,
        oldest: r.oldest,
      })),
    };
  });

  // -- restore --------------------------------------------------------------
  //  payload_json 을 같은 테이블에 다시 INSERT.
  //  이미 같은 PK 가 존재하면 id 를 빼고 새 PK 로 삽입 (UNIQUE 충돌 시 에러).
  //  성공 시 purged_at 갱신 (= "처리 완료" 표시).
  ipcMain.handle(
    'trash:restore',
    (event, payload: { id: number }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      const ts = db
        .prepare(
          `SELECT id, table_name, row_id, payload_json, purged_at
             FROM deleted_records WHERE id = ?`,
        )
        .get(payload.id) as
        | {
            id: number;
            table_name: string;
            row_id: number | null;
            payload_json: string;
            purged_at: string | null;
          }
        | undefined;
      if (!ts) return { ok: false as const, error: 'not_found' };
      if (ts.purged_at) return { ok: false as const, error: 'already_purged' };

      let row: Record<string, unknown>;
      try {
        row = JSON.parse(ts.payload_json) as Record<string, unknown>;
      } catch {
        return { ok: false as const, error: 'corrupt_payload' };
      }

      try {
        // 같은 PK 로 살아있는 행이 있는지 확인. 있으면 id 를 비우고 새 PK 부여.
        let useOriginalId = true;
        if (ts.row_id != null) {
          const existing = db
            .prepare(`SELECT 1 FROM ${ts.table_name} WHERE id = ?`)
            .get(ts.row_id);
          if (existing) useOriginalId = false;
        }

        const cols = Object.keys(row).filter((k) => useOriginalId || k !== 'id');
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map((c) => normalizeRestoreValue(row[c]));

        const info = db
          .prepare(
            `INSERT INTO ${ts.table_name} (${cols.join(', ')}) VALUES (${placeholders})`,
          )
          .run(...values);

        const restoredId = useOriginalId ? ts.row_id : Number(info.lastInsertRowid);

        // 만약 students 처럼 deleted_at 컬럼이 있고 SELECT 가 그걸로 필터한다면,
        // restore 했더라도 deleted_at 이 채워져 있을 수 있다. 안전하게 NULL 로.
        try {
          const colsInfo = db
            .prepare(`PRAGMA table_info(${ts.table_name})`)
            .all() as Array<{ name: string }>;
          if (colsInfo.some((c) => c.name === 'deleted_at')) {
            db.prepare(
              `UPDATE ${ts.table_name} SET deleted_at = NULL WHERE id = ?`,
            ).run(restoredId);
          }
        } catch (err) {
          console.warn('[ipc] trash:restore deleted_at clear failed', err);
        }

        // 휴지통 레코드는 purged_at 으로 마킹 — 다시 복원 못 하게.
        db.prepare(
          `UPDATE deleted_records SET purged_at = datetime('now') WHERE id = ?`,
        ).run(ts.id);

        logActivity(db, actor.userId, 'trash.restore', `tombstone:${ts.id}`, {
          table: ts.table_name,
          restoredId,
          newId: !useOriginalId,
        });

        return { ok: true as const, restoredId, newId: !useOriginalId };
      } catch (err) {
        console.error('[ipc] trash:restore error', err);
        return { ok: false as const, error: (err as Error).message ?? 'restore_failed' };
      }
    },
  );

  // -- purge (영구삭제) -----------------------------------------------------
  //  단일 또는 일괄. 단순히 deleted_records 에서 row 제거.
  ipcMain.handle(
    'trash:purge',
    (event, payload: { ids: number[] }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((x) => typeof x === 'number') : [];
      if (ids.length === 0) return { ok: false as const, error: 'no_ids' };
      const tx = db.transaction((arr: number[]) => {
        const stmt = db.prepare(`DELETE FROM deleted_records WHERE id = ?`);
        for (const id of arr) stmt.run(id);
      });
      tx(ids);
      logActivity(db, actor.userId, 'trash.purge', `tombstones:${ids.length}`, {
        ids,
      });
      return { ok: true as const, purged: ids.length };
    },
  );

  // -- purgeAll (카테고리/전체 비우기) -------------------------------------
  ipcMain.handle(
    'trash:purgeAll',
    (event, payload?: { category?: string | null }) => {
      const actor = requireRole(event, ROLE_SETS.opsAdmin);
      const db = getDb();
      const category = payload?.category && payload.category !== 'all' ? payload.category : null;
      const sql = category
        ? `DELETE FROM deleted_records WHERE purged_at IS NULL AND category = ?`
        : `DELETE FROM deleted_records WHERE purged_at IS NULL`;
      const res = category
        ? db.prepare(sql).run(category)
        : db.prepare(sql).run();
      logActivity(db, actor.userId, 'trash.purgeAll', `tombstones:${res.changes}`, {
        category,
      });
      return { ok: true as const, purged: res.changes };
    },
  );
}

// payload_json 미리보기용 — 비밀스럽거나 너무 긴 필드는 잘라서 반환.
function previewPayload(json: string): Record<string, string> {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'id' || k === 'created_at' || k === 'updated_at' || k === 'deleted_at') continue;
      if (count >= 8) break;
      let s: string;
      if (v == null) s = '∅';
      else if (typeof v === 'string') s = v.length > 60 ? `${v.slice(0, 57)}…` : v;
      else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
      else s = JSON.stringify(v).slice(0, 60);
      out[k] = s;
      count += 1;
    }
    return out;
  } catch {
    return {};
  }
}

// JSON 파싱 후 sqlite 가 안 받는 타입 (객체/배열/undefined) 을 string 으로 강제.
function normalizeRestoreValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return JSON.stringify(v);
}
