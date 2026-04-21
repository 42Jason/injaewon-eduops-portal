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
