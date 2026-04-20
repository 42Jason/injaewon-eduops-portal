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
