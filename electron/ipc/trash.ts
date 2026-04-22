import { ipcMain } from 'electron';
import { getDb } from '../db';
import { requireRole, ROLE_SETS } from '../auth';

type Db = ReturnType<typeof getDb>;

interface TrashIpcDeps {
  logActivity: (
    db: Db,
    actorId: number | null,
    action: string,
    target: string,
    meta: Record<string, unknown>,
  ) => void;
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
export function registerTrashIpc(deps: TrashIpcDeps) {
  const { logActivity } = deps;
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
