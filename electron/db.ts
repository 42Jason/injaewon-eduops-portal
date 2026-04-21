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

function applySchema(db: Db) {
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');
  db.exec(schema);
  runMigrations(db);
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
