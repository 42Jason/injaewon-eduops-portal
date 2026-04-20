#!/usr/bin/env node
/**
 * EduOps Portal — local DB bootstrap.
 *
 * Creates / migrates an SQLite database at the path resolved by
 * (in order of precedence):
 *   1. `--db=<path>` CLI flag
 *   2. `DB_PATH` env var
 *   3. `./db/eduops.db` (dev default)
 *
 * Usage:
 *   node scripts/init-db.js
 *   node scripts/init-db.js --db=C:/Users/foo/AppData/Roaming/EduOps/db/eduops.db
 *   node scripts/init-db.js --reset   # drops and recreates
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const dbFlag = args.find((a) => a.startsWith('--db='));

const dbPath =
  (dbFlag && dbFlag.slice('--db='.length)) ||
  process.env.DB_PATH ||
  path.join(__dirname, '..', 'db', 'eduops.db');

const schemaPath = path.join(__dirname, '..', 'src', 'shared', 'db', 'schema.sql');

if (!fs.existsSync(schemaPath)) {
  console.error(`schema.sql not found at ${schemaPath}`);
  process.exit(1);
}

const schema = fs.readFileSync(schemaPath, 'utf8');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

if (reset && fs.existsSync(dbPath)) {
  console.log(`[init-db] --reset: removing existing DB at ${dbPath}`);
  fs.unlinkSync(dbPath);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(schema);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`[init-db] OK — ${dbPath}`);
console.log(`[init-db] tables (${tables.length}): ${tables.join(', ')}`);

db.close();
