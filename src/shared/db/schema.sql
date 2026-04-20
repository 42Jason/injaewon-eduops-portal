-- =============================================================================
-- EduOps Employee Portal — SQLite schema
-- Based on the integrated development prompt §23.
-- Conventions:
--   * All timestamps stored as ISO-8601 TEXT (SQLite native date functions work).
--   * IDs are INTEGER PRIMARY KEY AUTOINCREMENT.
--   * Soft-delete via `deleted_at` where retention / audit matters.
--   * `created_at` / `updated_at` populated by application code (or triggers).
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN (
                   'CEO','CTO','OPS_MANAGER','HR_ADMIN',
                   'PARSER','QA1','QA_FINAL','CS','STAFF'
                 )),
  department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  title          TEXT,
  phone          TEXT,
  avatar_url     TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  joined_at      TEXT,
  leave_balance  REAL    NOT NULL DEFAULT 15.0,  -- 연차 기본 15 일
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

-- ---------------------------------------------------------------------------
-- Students (과제 대상 학생) — minimal, PII is kept intentionally light
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS students (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code TEXT    NOT NULL UNIQUE,   -- 학원 내부 학생 코드
  name         TEXT    NOT NULL,
  grade        TEXT,                      -- e.g. '중3', '고2'
  school       TEXT,
  guardian     TEXT,
  memo         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

-- ---------------------------------------------------------------------------
-- Instruction documents (업로드된 원본 안내문 Excel/PDF)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS instruction_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name  TEXT    NOT NULL,
  stored_path    TEXT    NOT NULL,                   -- userData 내부 상대 경로
  mime_type      TEXT,
  size_bytes     INTEGER,
  uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Assignments (과제) — 16단계 상태머신
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,        -- e.g. 'A-0241'
  subject         TEXT    NOT NULL,                -- 과목
  publisher       TEXT,                            -- 출판사
  student_id      INTEGER REFERENCES students(id) ON DELETE SET NULL,
  student_code    TEXT    NOT NULL,                -- 스펙 §9: 학생 코드 미러
  title           TEXT    NOT NULL,                -- 수행평가명
  scope           TEXT,                            -- 수행범위
  length_req      TEXT,                            -- 분량
  outline         TEXT,                            -- 개요
  rubric          TEXT,                            -- 평가기준
  teacher_req     TEXT,                            -- 교사요구
  student_req     TEXT,                            -- 학생요구
  state           TEXT    NOT NULL DEFAULT '신규접수' CHECK (state IN (
                    '신규접수','자료누락','파싱대기','파싱진행중',
                    '파싱완료','파싱확인필요',
                    '1차QA대기','1차QA진행중','1차QA반려',
                    '최종QA대기','최종QA진행중','최종QA반려',
                    '승인완료','수정요청','완료','보류'
                  )),
  risk            TEXT    NOT NULL DEFAULT 'low' CHECK (risk IN ('low','medium','high')),
  parser_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  qa1_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  qa_final_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  instruction_doc_id INTEGER REFERENCES instruction_documents(id) ON DELETE SET NULL,
  due_at          TEXT,
  received_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assignments_state     ON assignments(state);
CREATE INDEX IF NOT EXISTS idx_assignments_due       ON assignments(due_at);
CREATE INDEX IF NOT EXISTS idx_assignments_parser    ON assignments(parser_id);
CREATE INDEX IF NOT EXISTS idx_assignments_qa1       ON assignments(qa1_id);
CREATE INDEX IF NOT EXISTS idx_assignments_qa_final  ON assignments(qa_final_id);
CREATE INDEX IF NOT EXISTS idx_assignments_student   ON assignments(student_code);

-- ---------------------------------------------------------------------------
-- Parsing results (파싱 결과) — 1:1 with assignments but kept separate for history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS parsing_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id   INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  content_json    TEXT    NOT NULL,        -- 구조화된 파싱 결과 JSON
  ai_summary      TEXT,                    -- AI 분석 요약
  confidence      REAL,                    -- 0.0 ~ 1.0
  parsed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parsed_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parsing_results_assignment ON parsing_results(assignment_id);

-- ---------------------------------------------------------------------------
-- QA checklists & reviews
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS checklist_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage       TEXT    NOT NULL CHECK (stage IN ('QA1','QA_FINAL')),
  name        TEXT    NOT NULL,
  items_json  TEXT    NOT NULL,   -- [{ id, label, required }, ...]
  version     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS qa_reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id   INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  stage           TEXT    NOT NULL CHECK (stage IN ('QA1','QA_FINAL')),
  reviewer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  result          TEXT    NOT NULL CHECK (result IN ('approved','rejected','revision_requested')),
  checklist_json  TEXT,                -- {itemId: {checked, note}}
  comment         TEXT,
  reviewed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_assignment ON qa_reviews(assignment_id);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_reviewer   ON qa_reviews(reviewer_id);

-- ---------------------------------------------------------------------------
-- CS tickets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cs_tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,     -- e.g. 'CS-0101'
  channel         TEXT    NOT NULL CHECK (channel IN ('phone','email','kakao','other')),
  student_code    TEXT,
  inquirer        TEXT,                         -- 학부모/학생 이름
  subject         TEXT    NOT NULL,
  body            TEXT,
  priority        TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  assignee_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  related_assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  opened_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_cs_status   ON cs_tickets(status);
CREATE INDEX IF NOT EXISTS idx_cs_assignee ON cs_tickets(assignee_id);

-- ---------------------------------------------------------------------------
-- Attendance & leave
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date   TEXT    NOT NULL,                -- YYYY-MM-DD
  check_in    TEXT,
  check_out   TEXT,
  break_min   INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id, work_date);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('annual','half_am','half_pm','sick','special','unpaid')),
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  days         REAL    NOT NULL,
  reason       TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approver_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_user   ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);

-- ---------------------------------------------------------------------------
-- Approvals (전자 결재)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS approvals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,          -- e.g. 'AP-0050'
  title        TEXT    NOT NULL,
  kind         TEXT    NOT NULL,                 -- '휴가','지출','연장근무',...
  drafter_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payload_json TEXT,                              -- 결재 대상 원본 데이터
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  drafted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS approval_steps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id  INTEGER NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  step_order   INTEGER NOT NULL,
  approver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state        TEXT    NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','skipped')),
  comment      TEXT,
  decided_at   TEXT,
  UNIQUE (approval_id, step_order)
);

-- ---------------------------------------------------------------------------
-- Work logs (업무 일지)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date   TEXT    NOT NULL,
  summary    TEXT    NOT NULL,
  details    TEXT,
  tags       TEXT,                                -- comma separated
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_logs_user_date ON work_logs(user_id, log_date);

-- ---------------------------------------------------------------------------
-- Notices / manuals / documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  body_md     TEXT    NOT NULL,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  audience    TEXT    NOT NULL DEFAULT 'ALL',     -- 'ALL' or role code / department id
  pinned      INTEGER NOT NULL DEFAULT 0,
  published_at TEXT   NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (notice_id, user_id)
);

CREATE TABLE IF NOT EXISTS manual_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  body_md     TEXT    NOT NULL,
  category    TEXT,
  parent_id   INTEGER REFERENCES manual_pages(id) ON DELETE SET NULL,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  stored_path  TEXT    NOT NULL,
  mime_type    TEXT,
  size_bytes   INTEGER,
  folder       TEXT,
  tags         TEXT,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Notifications / activity / admin settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT    NOT NULL,     -- e.g. 'assignment.state_change'
  target     TEXT,                  -- 'assignment:241'
  meta_json  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);

CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT    PRIMARY KEY,
  value_json TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
