import { app, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { AuthError, requireActor, requireRole, ROLE_SETS } from '../auth';
import { resolveUserDataPath } from '../path-security';

type Db = ReturnType<typeof getDb>;

interface ParsingUploadIpcDeps {
  logActivity: (
    db: Db,
    actorId: number | null,
    action: string,
    target: string,
    meta: Record<string, unknown>,
  ) => void;
  recordDeletion: (
    db: Db,
    table: string,
    id: number,
    actorId: number | null,
    opts?: { reason?: string | null; label?: string | null; category?: string | null },
  ) => boolean;
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

export function registerParsingUploadsIpc(deps: ParsingUploadIpcDeps) {
  const { logActivity, recordDeletion } = deps;
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
        const abs = resolveUserDataPath(row.stored_path);
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
      const abs = resolveUserDataPath(row.stored_path);
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
        const abs = resolveUserDataPath(row.stored_path);
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
