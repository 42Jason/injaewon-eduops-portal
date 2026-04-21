/**
 * 구 DB 긴급 복구.
 *
 * v0.1.13 까지 applySchema 가 "single-pass" 였기 때문에 `CREATE INDEX ON
 * assignments(deleted_at)` 가 컬럼 없는 구 DB 에서 실패하면서 openDb 전체가
 * 날아가는 증상이 있었다. v0.1.14 는 double-pass 로 자동 복구하지만, 그 버전을
 * 설치하기 전에라도 기존 DB 를 미리 고쳐두면 v0.1.11 에서도 즉시 앱이 돈다.
 *
 * 사용법 (레포 루트에서):
 *    node scripts/repair-db.js
 *
 * DB 경로는 `%APPDATA%\eduops-portal\db\eduops.db` 를 기본으로 잡고, 환경변수
 * `DB_PATH` 로 덮어쓸 수 있다.
 */
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  // 윈도: %APPDATA% 가 기본. 리눅스/맥 은 ~/.config, ~/Library/Application Support 등.
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(appData, 'eduops-portal', 'db', 'eduops.db');
}

function columnsOf(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

function addColumnIfMissing(db, table, col, ddl) {
  const cols = columnsOf(db, table);
  if (cols.size === 0) {
    console.log(`  · ${table} 테이블이 없음 — 스킵`);
    return false;
  }
  if (cols.has(col)) {
    console.log(`  · ${table}.${col} 이미 있음`);
    return false;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`  ✓ ${table}.${col} 추가`);
  return true;
}

function ensureIndex(db, sql, label) {
  try {
    db.exec(sql);
    console.log(`  ✓ INDEX ${label}`);
  } catch (err) {
    console.warn(`  ⚠ INDEX ${label} 실패: ${err.message}`);
  }
}

function main() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`DB 파일이 없습니다: ${dbPath}`);
    console.error('앱을 한 번이라도 실행하신 적이 있어야 DB 파일이 생성됩니다.');
    process.exit(1);
  }

  const bak = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, bak);
  console.log(`백업 완료 → ${bak}`);

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  console.log('\n[1/3] assignments 테이블 복구');
  addColumnIfMissing(db, 'assignments', 'deleted_at', 'deleted_at TEXT');
  addColumnIfMissing(db, 'assignments', 'notion_page_id', 'notion_page_id TEXT');
  addColumnIfMissing(db, 'assignments', 'notion_source', 'notion_source TEXT');
  addColumnIfMissing(db, 'assignments', 'notion_synced_at', 'notion_synced_at TEXT');
  addColumnIfMissing(db, 'assignments', 'notion_extra', 'notion_extra TEXT');
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_assignments_deleted ON assignments(deleted_at)',
    'idx_assignments_deleted',
  );
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_assignments_notion_page ON assignments(notion_page_id)',
    'idx_assignments_notion_page',
  );

  console.log('\n[2/3] students 테이블 복구');
  addColumnIfMissing(db, 'students', 'monthly_fee', 'monthly_fee INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'students', 'billing_day', 'billing_day INTEGER NOT NULL DEFAULT 5');
  addColumnIfMissing(db, 'students', 'billing_active', 'billing_active INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'students', 'notion_page_id', 'notion_page_id TEXT');
  addColumnIfMissing(db, 'students', 'notion_source', 'notion_source TEXT');
  addColumnIfMissing(db, 'students', 'notion_synced_at', 'notion_synced_at TEXT');
  addColumnIfMissing(db, 'students', 'notion_extra', 'notion_extra TEXT');
  addColumnIfMissing(db, 'students', 'school_no', 'school_no TEXT');
  addColumnIfMissing(db, 'students', 'phone', 'phone TEXT');
  addColumnIfMissing(db, 'students', 'guardian_phone', 'guardian_phone TEXT');
  addColumnIfMissing(db, 'students', 'grade_memo', 'grade_memo TEXT');
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_students_notion_page ON students(notion_page_id)',
    'idx_students_notion_page',
  );

  console.log('\n[3/4] users 테이블 Notion 연동 컬럼');
  addColumnIfMissing(db, 'users', 'notion_user_id', 'notion_user_id TEXT');
  addColumnIfMissing(db, 'users', 'notion_synced_at', 'notion_synced_at TEXT');
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_users_notion_user ON users(notion_user_id)',
    'idx_users_notion_user',
  );

  console.log('\n[4/4] deleted_records (휴지통) 테이블');
  // v0.1.15 신규 — 모든 hard-DELETE 레코드를 보관하는 tombstone 로그.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_records (
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
      );
    `);
    console.log('  ✓ deleted_records 테이블');
  } catch (err) {
    console.warn(`  ⚠ deleted_records 테이블 실패: ${err.message}`);
  }
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_deleted_records_category ON deleted_records(category, deleted_at DESC)',
    'idx_deleted_records_category',
  );
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_deleted_records_table ON deleted_records(table_name, deleted_at DESC)',
    'idx_deleted_records_table',
  );
  ensureIndex(
    db,
    'CREATE INDEX IF NOT EXISTS idx_deleted_records_active ON deleted_records(purged_at)',
    'idx_deleted_records_active',
  );

  db.close();
  console.log('\n완료. 앱을 다시 실행하면 정상 동작해야 합니다.');
}

try {
  main();
} catch (err) {
  console.error('\n복구 실패:', err);
  process.exit(1);
}
