import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let dbInstance: Db | null = null;
let dbPath: string | null = null;

/**
 * Resolve the live DB file path.
 *
 * Precedence:
 *   1. `DB_PATH` env var (set via .env or CLI for tests)
 *   2. `<userData>/db/eduops.db` (production default)
 */
export function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'db');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'eduops.db');
}

const DAILY_BACKUPS_TO_KEEP = 7;
const MONTHLY_BACKUPS_TO_KEEP = 12;

function backupDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function rotateBackups(backupsDir: string) {
  const files = fs
    .readdirSync(backupsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
    .sort()
    .reverse();

  const keep = new Set<string>();
  for (const name of files.slice(0, DAILY_BACKUPS_TO_KEEP)) keep.add(name);

  const monthly = new Set<string>();
  for (const name of files) {
    const monthKey = name.slice(0, 7);
    if (monthly.has(monthKey)) continue;
    monthly.add(monthKey);
    keep.add(name);
    if (monthly.size >= MONTHLY_BACKUPS_TO_KEEP) break;
  }

  for (const name of files) {
    if (keep.has(name)) continue;
    try {
      fs.unlinkSync(path.join(backupsDir, name));
    } catch (err) {
      console.warn(`[db] backup cleanup skipped for ${name}:`, err);
    }
  }
}

function backupExistingDb(db: Db, currentPath: string, isFresh: boolean) {
  if (isFresh || process.env.EDUOPS_SKIP_DB_BACKUP === '1') return;
  const backupsDir = path.join(path.dirname(currentPath), 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const target = path.join(backupsDir, `${backupDateKey()}.sqlite`);
  if (fs.existsSync(target)) return;

  try {
    db.pragma('wal_checkpoint(FULL)');
    fs.copyFileSync(currentPath, target);
    rotateBackups(backupsDir);
    console.log(`[db] backup created: ${target}`);
  } catch (err) {
    console.warn('[db] startup backup failed:', err);
  }
}

/**
 * Resolve the bundled schema.sql — works both in dev (running from source)
 * and in a packaged app (where it lives alongside dist-electron).
 */
function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'src', 'shared', 'db', 'schema.sql'),       // dev
    path.join(process.resourcesPath || '', 'app', 'src', 'shared', 'db', 'schema.sql'), // packaged (asar.unpacked)
    path.join(__dirname, 'schema.sql'),                                     // copied next to main.js
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('[db] schema.sql not found in any known location');
}

function resolveMigrationsDir(): string | null {
  const schemaDir = path.dirname(resolveSchemaPath());
  const candidates = [
    path.join(schemaDir, 'migrations'),
    path.join(__dirname, '..', 'src', 'shared', 'db', 'migrations'),
    path.join(process.resourcesPath || '', 'app', 'src', 'shared', 'db', 'migrations'),
    path.join(__dirname, 'migrations'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

function applySchema(db: Db) {
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');

  // ──────────────────────────────────────────────────────────────────────
  // v0.1.13 까지의 치명 버그:
  //   schema.sql 에는 `CREATE INDEX … ON assignments(deleted_at)` 같이 구
  //   DB에 없는 컬럼을 참조하는 문장이 섞여 있다. 기존 사용자가 가진 구
  //   스키마에서는 `CREATE TABLE IF NOT EXISTS assignments(...)` 가 원본
  //   테이블을 그대로 두기 때문에 `deleted_at` 컬럼이 생기지 않고, 이어서
  //   실행되는 `CREATE INDEX` 가 `no such column: deleted_at` 로 전체 exec
  //   를 날리면서 `openDb()` 가 실패하여 앱 구동이 막혔다.
  //
  // 해결 전략(double-pass):
  //   1) 1차: schema 전체 실행을 **silently tolerate** 한다. INDEX 실패 등은
  //      경고만 남기고 다음 단계로.
  //   2) runMigrations — 누락된 컬럼을 ALTER ADD COLUMN 으로 보강.
  //   3) 2차: schema 전체 재실행. 이 시점에는 컬럼이 모두 존재하므로 INDEX
  //      도 정상 생성된다.
  //   이렇게 하면 구 DB 도 자동 복구되고, 신규 DB 는 1차에서 바로 완성된다.
  // ──────────────────────────────────────────────────────────────────────
  try {
    db.exec(schema);
  } catch (err) {
    console.warn(
      '[db] 1차 schema 적용 중 일부 실패 — 마이그레이션 후 재시도:',
      err instanceof Error ? err.message : err,
    );
  }

  // v0.1.16: schema_migrations 로그 테이블을 먼저 보장한다. 기존 imperative
  // 마이그레이션(아래 runMigrations) 은 PRAGMA 스니핑으로 idempotent 하기
  // 때문에 그대로 두고, 신규 마이그레이션만 runMigration(version, fn) 헬퍼로
  // 버전 로그를 남기는 "혼합" 체계를 쓴다. baseline 마크는 이 함수 말미에서.
  ensureMigrationsTable(db);

  runMigrations(db);

  try {
    db.exec(schema);
  } catch (err) {
    // 2차에서도 실패하면 진짜 문제. 이때는 상위로 전파해서 crash.log 에 박힌다.
    console.error('[db] 2차 schema 적용 실패:', err);
    throw err;
  }

  // schema.sql 을 source of truth 로 잠근 `001_baseline` 은 applySchema 가
  // 무사히 2차까지 통과한 **바로 이 시점** 에 마크한다. 이러면 기존 DB 든
  // 신규 DB 든 일관된 기준점에서 다음 마이그레이션이 시작된다.
  markApplied(db, '001_baseline');

  // v0.1.16 부터는 버전 로그 기반 마이그레이션을 여기 순서대로 등록한다.
  runMigration(db, '002_notifications_v2', migration_002_notifications_v2);
  runMigration(db, '003_restore_student_real_names', migration_003_restore_student_real_names);
  runNumberedSqlMigrations(db);
}

// ---------------------------------------------------------------------------
// 번호 기반 마이그레이션 인프라 (v0.1.16~)
// ---------------------------------------------------------------------------

interface MigrationRow {
  version: string;
  applied_at: string;
}

function ensureMigrationsTable(db: Db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version     TEXT    PRIMARY KEY,
       applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
  );
}

function isApplied(db: Db, version: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM schema_migrations WHERE version = ? LIMIT 1`)
    .get(version) as { 1: number } | undefined;
  return !!row;
}

function markApplied(db: Db, version: string) {
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`,
  ).run(version);
}

/**
 * 신규 마이그레이션 실행기.
 *
 * - 이미 적용되어 있으면 즉시 return — 멱등.
 * - `fn` 실행 중 예외가 나면 해당 버전은 **마크하지 않는다** — 다음 실행에서
 *   재시도.
 * - 기존 imperative runMigrations() 블록은 그대로 두고, 앞으로 추가되는
 *   변경만 이 헬퍼로 관리한다.
 */
function runMigration(db: Db, version: string, fn: (db: Db) => void) {
  if (isApplied(db, version)) return;
  try {
    fn(db);
    markApplied(db, version);
    console.log(`[db] migration applied: ${version}`);
  } catch (err) {
    console.error(`[db] migration failed: ${version} —`, err);
    // baseline 이후 마이그레이션 실패는 상위로 전파해 crash.log 에 박는다.
    // 기존 runMigrations 처럼 silently skip 하면 개발자가 릴리스 뒤에야
    // 발견하는 v0.1.11-14 재현이 된다.
    throw err;
  }
}

/**
 * 감사용: 지금까지 적용된 마이그레이션 목록. 진단 IPC 나 릴리스 페이지에서
 * 사용할 수 있다.
 */
export function listAppliedMigrations(db: Db): MigrationRow[] {
  ensureMigrationsTable(db);
  return db
    .prepare(`SELECT version, applied_at FROM schema_migrations ORDER BY version`)
    .all() as MigrationRow[];
}

function runNumberedSqlMigrations(db: Db) {
  ensureMigrationsTable(db);
  const dir = resolveMigrationsDir();
  if (!dir) return;

  const files = fs
    .readdirSync(dir)
    .filter((name) => /^\d{3}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    const version = path.basename(name, '.sql');
    if (isApplied(db, version)) continue;
    const filePath = path.join(dir, name);
    const sql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
    const tx = db.transaction(() => {
      if (sql) db.exec(sql);
      markApplied(db, version);
    });
    try {
      tx();
      console.log(`[db] SQL migration applied: ${version}`);
    } catch (err) {
      console.error(`[db] SQL migration failed: ${version}`, err);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// 002_notifications_v2 — 알림 센터 확장
// ---------------------------------------------------------------------------
// 기존 notifications 테이블은 공지 뿌리기용으로 설계되어 있었고 (kind/title/
// body/link/read_at) dedup·snooze·entity 참조·처리 상태가 없어 "진짜 알림함"
// 으로는 쓸 수 없었다. 이 마이그레이션은 같은 테이블을 확장해서 기존 row 는
// 그대로 보존하되 새 컬럼만 추가한다:
//
//   category         — 'approval' | 'assignment' | 'qa' | 'cs' | 'tuition'
//                      | 'trash' | 'notice' | 'system' (기존 kind 와 별개의
//                      의미론적 분류. UI 필터/아이콘에 사용)
//   entity_table     — 연결된 엔티티 테이블명 (예: 'approvals')
//   entity_id        — 엔티티 row id
//   dedupe_key       — 동일 이벤트 중복 억제용 자연키.
//                      partial unique (dismissed_at IS NULL, dedupe_key IS NOT NULL)
//   priority         — 0=normal, 1=high, -1=low
//   snooze_until     — 이 시각까지 드로워에서 숨김
//   dismissed_at     — 처리 완료로 드로워에서 제거된 시각 (읽음과 별개)
//   payload_json     — 추가 메타(예: 학원비 금액, 결재 단계)
//
// 기존 컬럼(kind/title/body/link/read_at) 은 유지 — TopBar 공지 흐름 하위호환.
// 생산자 코드는 category 를 채우고 kind 도 병행 채우는 전환기 가짐.

function migration_002_notifications_v2(db: Db) {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(notifications)`).all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  if (cols.size === 0) {
    // 스키마 단계에서 CREATE 됐어야 함. 여기 왔다면 상위에서 잡혀야 한다.
    throw new Error('notifications 테이블이 존재하지 않음 — schema.sql 적용 상태 이상');
  }

  const addIfMissing = (col: string, ddl: string) => {
    if (!cols.has(col)) db.exec(`ALTER TABLE notifications ADD COLUMN ${ddl}`);
  };
  addIfMissing('category', `category TEXT NOT NULL DEFAULT 'notice'`);
  addIfMissing('entity_table', `entity_table TEXT`);
  addIfMissing('entity_id', `entity_id INTEGER`);
  addIfMissing('dedupe_key', `dedupe_key TEXT`);
  addIfMissing('priority', `priority INTEGER NOT NULL DEFAULT 0`);
  addIfMissing('snooze_until', `snooze_until TEXT`);
  addIfMissing('dismissed_at', `dismissed_at TEXT`);
  addIfMissing('payload_json', `payload_json TEXT`);

  // 읽지 않은·처리 안 된 알림을 빠르게 집계하기 위한 인덱스.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_active
       ON notifications(user_id, dismissed_at, read_at, created_at DESC)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_category
       ON notifications(user_id, category, created_at DESC)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_entity
       ON notifications(entity_table, entity_id)`,
  );

  // dedup: "같은 사용자 + 같은 dedupe_key + 아직 처리 안 된" 알림이 2개 이상
  // 생성되는 걸 DB 레벨에서 차단. dedupe_key 가 NULL 이면 제외 — 공지 같은
  // 일반 알림은 중복 허용. NULL 인 row 를 인덱스에서 빼기 위해 partial.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe_active
       ON notifications(user_id, dedupe_key)
       WHERE dedupe_key IS NOT NULL AND dismissed_at IS NULL`,
  );
}

function readStudentRealNameFromNotionExtra(extraJson: string | null): string {
  if (!extraJson) return '';
  try {
    const parsed = JSON.parse(extraJson) as { properties?: Record<string, unknown> } | null;
    const props = parsed?.properties;
    if (!props || typeof props !== 'object') return '';
    for (const key of ['ㅤ', '실명', '학생명', '학생 이름', '학생이름', '성명', '이름']) {
      const raw = props[key];
      if (raw === null || raw === undefined) continue;
      const value = String(raw).trim();
      if (!value || value.includes('*')) continue;
      return value;
    }
  } catch {
    return '';
  }
  return '';
}

function migration_003_restore_student_real_names(db: Db) {
  const rows = db
    .prepare(
      `SELECT id, name, notion_extra
         FROM students
        WHERE notion_extra IS NOT NULL
          AND (name LIKE '%*%' OR IFNULL(name, '') = '')`,
    )
    .all() as Array<{ id: number; name: string | null; notion_extra: string | null }>;

  const update = db.prepare(`UPDATE students SET name = ? WHERE id = ?`);
  let restored = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const realName = readStudentRealNameFromNotionExtra(row.notion_extra);
      if (!realName) continue;
      update.run(realName, row.id);
      restored += 1;
    }
  });
  tx();
  if (restored > 0) {
    console.log(`[db] restored ${restored} student real names from Notion raw properties`);
  }
}

/**
 * Additive migrations for columns that CANNOT be handled by
 * `CREATE TABLE IF NOT EXISTS` (because the table already existed).
 *
 * Every step is idempotent — we sniff the current column list with
 * `PRAGMA table_info(...)` before issuing an ALTER. This lets us ship
 * schema changes to users who already have a populated DB without
 * crashing on re-run.
 */
function runMigrations(db: Db) {
  interface ColumnRow {
    name: string;
  }
  const columns = (table: string): Set<string> => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnRow[];
    return new Set(rows.map((r) => r.name));
  };

  // --- students: tuition billing defaults --------------------------------
  try {
    const cols = columns('students');
    if (!cols.has('monthly_fee')) {
      db.exec(`ALTER TABLE students ADD COLUMN monthly_fee INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.has('billing_day')) {
      db.exec(`ALTER TABLE students ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 5`);
    }
    if (!cols.has('billing_active')) {
      db.exec(`ALTER TABLE students ADD COLUMN billing_active INTEGER NOT NULL DEFAULT 1`);
    }
  } catch (err) {
    console.warn('[db] students migration skipped:', err);
  }

  // --- student_archive_files: auto-archive linkage -----------------------
  // 최종 승인된 과제를 보관함 레코드와 역추적하기 위해 추가된 컬럼.
  // 기존 DB에는 없으므로 idempotent하게 ALTER.
  try {
    const cols = columns('student_archive_files');
    if (cols.size > 0) {
      if (!cols.has('source_assignment_id')) {
        db.exec(
          `ALTER TABLE student_archive_files
             ADD COLUMN source_assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL`,
        );
      }
      if (!cols.has('auto_generated')) {
        db.exec(
          `ALTER TABLE student_archive_files
             ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0`,
        );
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_student_archive_files_source
           ON student_archive_files(source_assignment_id)`,
      );
    }
  } catch (err) {
    console.warn('[db] student_archive_files migration skipped:', err);
  }

  // --- students: Notion 연동 컬럼 -----------------------------------------
  // notion_page_id 는 노션 페이지 고유 ID(대시 포함). notion_source 는
  // 어느 노션 DB에서 왔는지 라벨(예: "consulting" / "sugang" / "gumiho").
  // notion_extra 는 매핑되지 않은 전체 프로퍼티를 JSON 문자열로 보관.
  try {
    const cols = columns('students');
    if (cols.size > 0) {
      if (!cols.has('notion_page_id')) {
        db.exec(`ALTER TABLE students ADD COLUMN notion_page_id TEXT`);
      }
      if (!cols.has('notion_source')) {
        db.exec(`ALTER TABLE students ADD COLUMN notion_source TEXT`);
      }
      if (!cols.has('notion_synced_at')) {
        db.exec(`ALTER TABLE students ADD COLUMN notion_synced_at TEXT`);
      }
      if (!cols.has('notion_extra')) {
        db.exec(`ALTER TABLE students ADD COLUMN notion_extra TEXT`);
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_students_notion_page
           ON students(notion_page_id)`,
      );
    }
  } catch (err) {
    console.warn('[db] students Notion 컬럼 추가 skipped:', err);
  }

  // --- users: Notion 연동 컬럼 --------------------------------------------
  try {
    const cols = columns('users');
    if (cols.size > 0) {
      if (!cols.has('notion_user_id')) {
        db.exec(`ALTER TABLE users ADD COLUMN notion_user_id TEXT`);
      }
      if (!cols.has('notion_synced_at')) {
        db.exec(`ALTER TABLE users ADD COLUMN notion_synced_at TEXT`);
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_users_notion_user
           ON users(notion_user_id)`,
      );
    }
  } catch (err) {
    console.warn('[db] users Notion 컬럼 추가 skipped:', err);
  }

  // --- notion_sync_runs: 동기화 이력 (기존 DB에도 생성) --------------------
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS notion_sync_runs (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         kind          TEXT    NOT NULL CHECK (kind IN ('students','staff','probe','assignments')),
         started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
         finished_at   TEXT,
         ok            INTEGER NOT NULL DEFAULT 0,
         inserted      INTEGER NOT NULL DEFAULT 0,
         updated       INTEGER NOT NULL DEFAULT 0,
         skipped       INTEGER NOT NULL DEFAULT 0,
         errors        INTEGER NOT NULL DEFAULT 0,
         message       TEXT,
         triggered_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
       )`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_notion_sync_runs_kind
         ON notion_sync_runs(kind, started_at DESC)`,
    );
  } catch (err) {
    console.warn('[db] notion_sync_runs 생성 skipped:', err);
  }

  // --- notion_sync_runs.kind CHECK 확장 ('assignments' 추가) ---------------
  // SQLite 는 컬럼 CHECK 제약 변경을 직접 지원하지 않으므로, 이전 버전 DB 에서는
  // 테이블 통째로 재생성한다. 현재 CHECK 정의를 sqlite_master 에서 읽어
  // 'assignments' 문자열이 있는지 스니핑 — 없으면 리빌드.
  try {
    const defRow = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notion_sync_runs'`)
      .get() as { sql: string } | undefined;
    const currentSql = defRow?.sql ?? '';
    if (currentSql && !currentSql.includes("'assignments'")) {
      db.exec('BEGIN');
      try {
        db.exec(
          `CREATE TABLE notion_sync_runs__new (
             id            INTEGER PRIMARY KEY AUTOINCREMENT,
             kind          TEXT    NOT NULL CHECK (kind IN ('students','staff','probe','assignments')),
             started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
             finished_at   TEXT,
             ok            INTEGER NOT NULL DEFAULT 0,
             inserted      INTEGER NOT NULL DEFAULT 0,
             updated       INTEGER NOT NULL DEFAULT 0,
             skipped       INTEGER NOT NULL DEFAULT 0,
             errors        INTEGER NOT NULL DEFAULT 0,
             message       TEXT,
             triggered_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
           )`,
        );
        db.exec(
          `INSERT INTO notion_sync_runs__new
             (id, kind, started_at, finished_at, ok, inserted, updated, skipped, errors, message, triggered_by)
           SELECT id, kind, started_at, finished_at, ok, inserted, updated, skipped, errors, message, triggered_by
             FROM notion_sync_runs`,
        );
        db.exec(`DROP TABLE notion_sync_runs`);
        db.exec(`ALTER TABLE notion_sync_runs__new RENAME TO notion_sync_runs`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_notion_sync_runs_kind
             ON notion_sync_runs(kind, started_at DESC)`,
        );
        db.exec('COMMIT');
      } catch (rebuildErr) {
        db.exec('ROLLBACK');
        throw rebuildErr;
      }
    }
  } catch (err) {
    console.warn('[db] notion_sync_runs CHECK 확장 skipped:', err);
  }

  // --- assignments: Notion 연동 컬럼 --------------------------------------
  // "컨설팅 과제 의뢰" DB 에서 끌어온 과제 페이지를 notion_page_id 기준으로
  // 멱등 upsert 하기 위한 컬럼. 기존 DB 에도 추가로 칠해준다.
  try {
    const cols = columns('assignments');
    if (cols.size > 0) {
      if (!cols.has('notion_page_id')) {
        db.exec(`ALTER TABLE assignments ADD COLUMN notion_page_id TEXT`);
      }
      if (!cols.has('notion_source')) {
        db.exec(`ALTER TABLE assignments ADD COLUMN notion_source TEXT`);
      }
      if (!cols.has('notion_synced_at')) {
        db.exec(`ALTER TABLE assignments ADD COLUMN notion_synced_at TEXT`);
      }
      if (!cols.has('notion_extra')) {
        db.exec(`ALTER TABLE assignments ADD COLUMN notion_extra TEXT`);
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_assignments_notion_page
           ON assignments(notion_page_id)`,
      );
    }
  } catch (err) {
    console.warn('[db] assignments Notion 컬럼 추가 skipped:', err);
  }

  // --- students: 연락처·학번·내신 메모 컬럼 --------------------------------
  try {
    const cols = columns('students');
    if (cols.size > 0) {
      if (!cols.has('school_no')) {
        db.exec(`ALTER TABLE students ADD COLUMN school_no TEXT`);
      }
      if (!cols.has('phone')) {
        db.exec(`ALTER TABLE students ADD COLUMN phone TEXT`);
      }
      if (!cols.has('guardian_phone')) {
        db.exec(`ALTER TABLE students ADD COLUMN guardian_phone TEXT`);
      }
      if (!cols.has('grade_memo')) {
        db.exec(`ALTER TABLE students ADD COLUMN grade_memo TEXT`);
      }
    }
  } catch (err) {
    console.warn('[db] students 연락처/내신 컬럼 skipped:', err);
  }

  // --- assignments: 소프트 삭제 컬럼 ---------------------------------------
  try {
    const cols = columns('assignments');
    if (cols.size > 0 && !cols.has('deleted_at')) {
      db.exec(`ALTER TABLE assignments ADD COLUMN deleted_at TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_assignments_deleted ON assignments(deleted_at)`,
      );
    }
  } catch (err) {
    console.warn('[db] assignments.deleted_at 추가 skipped:', err);
  }

  // --- student_grades: 내신 성적 테이블 -----------------------------------
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS student_grades (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
         grade_level   TEXT    NOT NULL,
         semester      TEXT    NOT NULL,
         subject       TEXT    NOT NULL,
         score         TEXT,
         raw_score     REAL,
         memo          TEXT,
         created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
         created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
         updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
         UNIQUE (student_id, grade_level, semester, subject)
       )`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_student_grades_student ON student_grades(student_id)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_student_grades_term
         ON student_grades(student_id, grade_level, semester)`,
    );
  } catch (err) {
    console.warn('[db] student_grades 생성 skipped:', err);
  }

  // --- student_counseling_logs: 상담 이력 테이블 --------------------------
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS student_counseling_logs (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
         log_date      TEXT    NOT NULL,
         title         TEXT    NOT NULL,
         body          TEXT,
         category      TEXT,
         created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
         created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
         updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_student_counseling_student
         ON student_counseling_logs(student_id, log_date DESC)`,
    );
  } catch (err) {
    console.warn('[db] student_counseling_logs 생성 skipped:', err);
  }

  // --- users.role CHECK 확장 ('TA' 추가) ----------------------------------
  // v0.1.12 에서 조교(TA) 역할이 추가됨. 기존 설치본의 users 테이블 CHECK 은
  // 'TA' 를 모르기 때문에 INSERT/UPDATE 시 제약 위반이 난다. notion_sync_runs
  // 와 동일한 패턴으로 테이블을 통째로 재생성. sqlite_master 스니핑으로
  // 멱등 보장.
  //
  // ⚠️ v0.1.12 에서는 `PRAGMA foreign_keys = ON` 상태 그대로 이 재구축을
  //    실행하는 치명 버그가 있었다. users 를 FK 로 참조하는 자식 테이블 37 곳
  //    중:
  //      - RESTRICT (qa.reviewer_id, approvals.drafter_id/approver_id) →
  //        자식에 행이 있으면 DROP TABLE users 가 즉시 실패.
  //      - CASCADE (attendance, work_logs, notifications 등) → DROP 시 자식
  //        데이터가 통째로 삭제됨.
  //      - SET NULL (~25 곳) → DROP 시 자식의 FK 컬럼이 NULL 로 덮어쓰여짐.
  //    운영 중인 DB 에서는 RESTRICT 에 걸려 BEGIN/ROLLBACK → 바깥 catch 가
  //    에러를 삼키고, users 는 구 CHECK 상태로 남아 조교(TA) 계정 추가가
  //    영구적으로 실패.
  //
  //    정석 해법 (SQLite 공식 "Making Other Kinds Of Table Schema Changes"):
  //      1) PRAGMA foreign_keys = OFF
  //      2) BEGIN
  //      3) 자식 테이블은 그대로 두고 users 만 안전하게 스왑
  //      4) PRAGMA foreign_key_check — 남은 위반 없음을 확인
  //      5) COMMIT
  //      6) PRAGMA foreign_keys = ON
  try {
    const defRow = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get() as { sql: string } | undefined;
    const currentSql = defRow?.sql ?? '';
    if (currentSql && !currentSql.includes("'TA'")) {
      // FK 가 켜진 상태로 DROP TABLE 하면 자식 테이블에 ON DELETE 액션이
      // 발화된다. 스키마 재구축은 "정의 변경"이지 "행 삭제" 가 아니므로
      // 자식 테이블이 그 사실을 알 필요가 없다. 토글로 막는다.
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN');
      try {
        db.exec(
          `CREATE TABLE users__new (
             id             INTEGER PRIMARY KEY AUTOINCREMENT,
             email          TEXT    NOT NULL UNIQUE,
             password_hash  TEXT    NOT NULL,
             name           TEXT    NOT NULL,
             role           TEXT    NOT NULL CHECK (role IN (
                              'CEO','CTO','OPS_MANAGER','HR_ADMIN',
                              'PARSER','QA1','QA_FINAL','CS','STAFF','TA'
                            )),
             department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
             title          TEXT,
             phone          TEXT,
             avatar_url     TEXT,
             active         INTEGER NOT NULL DEFAULT 1,
             joined_at      TEXT,
             leave_balance  REAL    NOT NULL DEFAULT 15.0,
             created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
             updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
             notion_user_id TEXT,
             notion_synced_at TEXT
           )`,
        );
        // 기존에 존재하는 컬럼만 골라서 복사 — notion_* 는 앞선 마이그레이션에서
        // 추가됐을 수도 있고 아닐 수도 있기 때문에 COALESCE 로 방어.
        const oldCols = new Set(
          (db.prepare(`PRAGMA table_info(users)`).all() as ColumnRow[]).map((r) => r.name),
        );
        const pick = (col: string, fallback = 'NULL') => (oldCols.has(col) ? col : fallback);
        db.exec(
          `INSERT INTO users__new
             (id, email, password_hash, name, role, department_id, title, phone, avatar_url,
              active, joined_at, leave_balance, created_at, updated_at,
              notion_user_id, notion_synced_at)
           SELECT id, email, password_hash, name, role, department_id,
                  ${pick('title')}, ${pick('phone')}, ${pick('avatar_url')},
                  ${pick('active', '1')}, ${pick('joined_at')}, ${pick('leave_balance', '15.0')},
                  ${pick('created_at', "datetime('now')")}, ${pick('updated_at', "datetime('now')")},
                  ${pick('notion_user_id')}, ${pick('notion_synced_at')}
             FROM users`,
        );
        db.exec(`DROP TABLE users`);
        db.exec(`ALTER TABLE users__new RENAME TO users`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_users_notion_user ON users(notion_user_id)`);

        // 자식 테이블 FK 가 새 users 를 제대로 가리키는지 검증.
        // ALTER TABLE ... RENAME TO 는 SQLite 3.26+ 에서 타 테이블의 FK 참조를
        // 자동으로 새 이름으로 갱신해준다. 그래도 무결성을 재확인.
        const violations = db
          .prepare('PRAGMA foreign_key_check')
          .all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
        if (violations.length > 0) {
          throw new Error(
            `FK violations after users rebuild: ${JSON.stringify(violations.slice(0, 5))}`,
          );
        }
        db.exec('COMMIT');
      } catch (rebuildErr) {
        db.exec('ROLLBACK');
        throw rebuildErr;
      } finally {
        // 성공이든 실패든 FK 는 반드시 다시 켠다.
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
  } catch (err) {
    console.warn('[db] users.role CHECK 확장 skipped:', err);
    // 안전망: 혹시 BEGIN 은 됐는데 토글이 꼬여 FK 가 OFF 로 남았다면 복구.
    try { db.exec('PRAGMA foreign_keys = ON'); } catch { /* ignore */ }
  }

  // --- parsed_excel_uploads: TA 파싱 결과 업로드함 -------------------------
  // 조교가 파싱해서 만든 엑셀을 담고, 정규직이 '소비' 표시할 수 있는 워크큐.
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS parsed_excel_uploads (
         id                  INTEGER PRIMARY KEY AUTOINCREMENT,
         uploader_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
         original_name       TEXT    NOT NULL,
         stored_path         TEXT    NOT NULL,
         mime_type           TEXT,
         size_bytes          INTEGER,
         note                TEXT,
         student_code        TEXT,
         subject             TEXT,
         title               TEXT,
         status              TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN (
                               'pending','consumed','archived'
                             )),
         consumed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
         consumed_at         TEXT,
         consumed_note       TEXT,
         uploaded_at         TEXT    NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_parsed_uploads_status
         ON parsed_excel_uploads(status)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_parsed_uploads_uploader
         ON parsed_excel_uploads(uploader_user_id)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_parsed_uploads_uploaded
         ON parsed_excel_uploads(uploaded_at DESC)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_parsed_uploads_student
         ON parsed_excel_uploads(student_code)`,
    );
  } catch (err) {
    console.warn('[db] parsed_excel_uploads 생성 skipped:', err);
  }

  // --- deleted_records: 통합 휴지통 (v0.1.15) ------------------------------
  // 모든 hard-DELETE 직전에 원본 row 를 JSON 으로 여기 남긴다. 복원은 JSON 을
  // 다시 INSERT 하면 된다. 구 DB 에도 추가되도록 여기서 CREATE IF NOT EXISTS.
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS deleted_records (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         table_name    TEXT    NOT NULL,
         row_id        INTEGER,
         category      TEXT    NOT NULL DEFAULT 'other',
         label         TEXT,
         payload_json  TEXT    NOT NULL,
         reason        TEXT,
         deleted_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
         deleted_at    TEXT    NOT NULL DEFAULT (datetime('now')),
         purged_at     TEXT
       )`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_deleted_records_category
         ON deleted_records(category, deleted_at DESC)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_deleted_records_table
         ON deleted_records(table_name, deleted_at DESC)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_deleted_records_active
         ON deleted_records(purged_at)`,
    );
  } catch (err) {
    console.warn('[db] deleted_records 생성 skipped:', err);
  }
}

/**
 * Open (and if needed, bootstrap) the SQLite database.
 * Safe to call multiple times — returns the same instance.
 */
export function openDb(): Db {
  if (dbInstance) return dbInstance;

  dbPath = resolveDbPath();
  const isFresh = !fs.existsSync(dbPath);

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  backupExistingDb(dbInstance, dbPath, isFresh);

  if (isFresh) {
    console.log(`[db] bootstrapping new DB at ${dbPath}`);
    applySchema(dbInstance);
  } else {
    // idempotent: schema uses CREATE TABLE IF NOT EXISTS so re-running is safe
    applySchema(dbInstance);
  }

  return dbInstance;
}

export function getDb(): Db {
  if (!dbInstance) return openDb();
  return dbInstance;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function getDbPath(): string {
  return dbPath ?? resolveDbPath();
}
