import { ipcMain, BrowserWindow, app } from 'electron';
import { getDb, getDbPath } from './db';
import {
  login,
  setSession,
  clearSession,
  getActor,
  requireActor,
  requireRole,
  ROLES,
  ROLE_SETS,
  type SessionActor,
  AuthError,
} from './auth';
import { parseInstructionExcel, type ParsedRow } from './parseExcel';
import { registerParsingUploadsIpc } from './ipc/parsing-uploads';
import { registerTrashIpc } from './ipc/trash';
import { registerNotificationsIpc } from './ipc/notifications';
import { registerAdminIpc } from './ipc/admin';
import { registerStudentArchiveIpc } from './ipc/student-archive';
import { registerReleaseIpc } from './ipc/release';
import { registerAssignmentsIpc } from './ipc/assignments';
import { registerPeopleIpc } from './ipc/people';
import { registerCsIpc } from './ipc/cs';
import { registerApprovalsIpc } from './ipc/approvals';
import { registerBoardQaIpc } from './ipc/board-qa';
import { registerKnowledgeIpc } from './ipc/knowledge';
import {
  dismissEntityNotifications,
  logActivity,
  notifyAssignmentStateChange,
  recordDeletion,
  recordNotification,
  syncAssignmentArchive,
} from './ipc/shared';

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

  registerAssignmentsIpc();

  // -- notices ----------------------------------------------------------------
  ipcMain.handle('notices:list', (event) => {
    requireActor(event);
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
  ipcMain.handle('home:stats', (event, userId?: number) => {
    const actor = requireActor(event);
    const targetUserId =
      typeof userId === 'number' && Number.isFinite(userId) ? userId : actor.userId;
    if (targetUserId !== actor.userId) {
      requireRole(event, ROLE_SETS.userStatsReader);
    }
    const db = getDb();
    const single = (sql: string, ...p: unknown[]) =>
      (db.prepare(sql).get(...p) as { n: number }).n;

    const todayMine = single(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE (parser_id = ? OR qa1_id = ? OR qa_final_id = ?)
          AND state NOT IN ('완료','보류')`,
      targetUserId, targetUserId, targetUserId,
    );
    const dueToday = single(
      `SELECT COUNT(*) AS n FROM assignments
        WHERE (parser_id = ? OR qa1_id = ? OR qa_final_id = ?)
          AND date(due_at) = date('now')`,
      targetUserId, targetUserId, targetUserId,
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
      targetUserId, targetUserId, targetUserId,
    );
    const awaitingApp = single(
      `SELECT COUNT(*) AS n FROM approval_steps s
          JOIN approvals a ON a.id = s.approval_id
         WHERE s.approver_id = ? AND s.state = 'pending' AND a.status = 'pending'`,
      targetUserId,
    );
    const unreadNotice = single(
      `SELECT COUNT(*) AS n FROM notices n
         WHERE n.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = ?)`,
      targetUserId,
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
    (event, payload: { buffer: ArrayBuffer | Uint8Array; filename: string }) => {
      requireRole(event, ROLE_SETS.parsingUploader);
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
    (event, payload: { rows: ParsedRow[]; uploaderId: number; filename: string }) => {
      const actor = requireRole(event, ROLE_SETS.parser);
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
              actor.userId,
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
  ipcMain.handle('parsing:recent', (event) => {
    requireRole(event, ROLE_SETS.parsingUploader);
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

  registerPeopleIpc();

  registerCsIpc();

  registerApprovalsIpc();

  registerBoardQaIpc();

  registerKnowledgeIpc();

  registerAdminIpc({ logActivity, recordDeletion, dismissEntityNotifications });
  registerStudentArchiveIpc({ logActivity, recordDeletion });
  registerReleaseIpc(meta.version, { logActivity });
  registerParsingUploadsIpc({ logActivity, recordDeletion });
  registerTrashIpc({ logActivity });
  registerNotificationsIpc();
}
