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
