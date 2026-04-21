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
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code   TEXT    NOT NULL UNIQUE,   -- 학원 내부 학생 코드
  name           TEXT    NOT NULL,
  grade          TEXT,                      -- e.g. '중3', '고2'
  school         TEXT,
  school_no      TEXT,                      -- 학번 (학교 내부)
  phone          TEXT,                      -- 학생 연락처
  guardian       TEXT,                      -- 학부모 이름
  guardian_phone TEXT,                      -- 학부모 연락처
  grade_memo     TEXT,                      -- 내신 한 줄 메모 ('수학1등급, 국어2등급')
  memo           TEXT,                      -- 일반 메모
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
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
  deleted_at      TEXT,                            -- 소프트 삭제 (NULL 이면 활성)
  notion_page_id  TEXT,                            -- 노션 "컨설팅 과제 의뢰" 페이지 ID (upsert 키)
  notion_source   TEXT,                            -- 어느 노션 DB 에서 왔는지 라벨
  notion_synced_at TEXT,                           -- 마지막 성공 싱크 시각
  notion_extra    TEXT,                            -- 매핑되지 않은 프로퍼티 + 파일 URL 을 JSON 으로 백업
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assignments_state     ON assignments(state);
CREATE INDEX IF NOT EXISTS idx_assignments_deleted   ON assignments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_assignments_due       ON assignments(due_at);
CREATE INDEX IF NOT EXISTS idx_assignments_parser    ON assignments(parser_id);
CREATE INDEX IF NOT EXISTS idx_assignments_qa1       ON assignments(qa1_id);
CREATE INDEX IF NOT EXISTS idx_assignments_qa_final  ON assignments(qa_final_id);
CREATE INDEX IF NOT EXISTS idx_assignments_student   ON assignments(student_code);
CREATE INDEX IF NOT EXISTS idx_assignments_notion_page ON assignments(notion_page_id);

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

-- ---------------------------------------------------------------------------
-- Notion sync runs (수동 트리거 기반 노션 동기화 이력)
-- 한 행 = students 또는 staff 한 번 동기화 호출 결과 요약
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notion_sync_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('students','staff','probe','assignments')),
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  ok            INTEGER NOT NULL DEFAULT 0,            -- boolean (1 = success)
  inserted      INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  message       TEXT,                                  -- last error or summary
  triggered_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notion_sync_runs_kind ON notion_sync_runs(kind, started_at DESC);

-- ===========================================================================
-- Administrative: tuition (학원비 수납) + payroll (급여)
--                + recurring subscriptions (정기 결제)
--                + corporate cards (법인 카드)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Students — extend with monthly tuition fee (recurring 월별 정기 청구 기본값).
-- Existing installs are upgraded at boot via migration statements in db.ts.
-- ---------------------------------------------------------------------------
-- NOTE: additive columns for existing `students` table (see db.ts migrations):
--   ALTER TABLE students ADD COLUMN monthly_fee INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE students ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 5;
--   ALTER TABLE students ADD COLUMN billing_active INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Tuition invoices (학원비 고지서) — one row per student per yyyymm.
-- Rows are created by the admin "월 청구서 생성" action (bulk) or inline.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tuition_invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_code   TEXT    NOT NULL,               -- 학생 코드 미러 (검색/내보내기용)
  period_yyyymm  TEXT    NOT NULL,               -- e.g. '2026-04'
  due_date       TEXT,                           -- YYYY-MM-DD (선택)
  base_amount    INTEGER NOT NULL DEFAULT 0,     -- 기본 수강료 (원)
  discount       INTEGER NOT NULL DEFAULT 0,     -- 할인 (원, 양수)
  adjustment     INTEGER NOT NULL DEFAULT 0,     -- 가산/조정 (원, 양수=추가 청구)
  total_amount   INTEGER NOT NULL DEFAULT 0,     -- 실제 청구 합계 (base - discount + adjustment)
  paid_amount    INTEGER NOT NULL DEFAULT 0,     -- 누적 수납 (여러 번 분할 가능)
  status         TEXT    NOT NULL DEFAULT 'unpaid' CHECK (status IN (
                   'unpaid','partial','paid','waived','cancelled'
                 )),
  memo           TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, period_yyyymm)
);
CREATE INDEX IF NOT EXISTS idx_tuition_invoices_period ON tuition_invoices(period_yyyymm);
CREATE INDEX IF NOT EXISTS idx_tuition_invoices_status ON tuition_invoices(status);
CREATE INDEX IF NOT EXISTS idx_tuition_invoices_student ON tuition_invoices(student_id);

-- ---------------------------------------------------------------------------
-- Tuition payments — actual collections against an invoice.
-- Split into a separate table so partial payments / refunds are auditable.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tuition_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES tuition_invoices(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL,                -- 원 단위. 음수면 환불.
  method       TEXT    NOT NULL CHECK (method IN ('cash','card','transfer','other')),
  paid_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  receipt_no   TEXT,                            -- 영수증 번호 (선택)
  note         TEXT,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_invoice ON tuition_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_tuition_payments_paid    ON tuition_payments(paid_at);

-- ---------------------------------------------------------------------------
-- Employee payroll profile — per-user baseline used to generate payslips.
-- Kept separate from `users` so payroll data can be edited by HR_ADMIN
-- without touching identity/auth columns.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_payroll_profiles (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employment_type      TEXT    NOT NULL DEFAULT 'regular' CHECK (employment_type IN (
                         'regular','freelancer','parttime'
                       )),
  base_salary          INTEGER NOT NULL DEFAULT 0,   -- 월 기본급
  position_allowance   INTEGER NOT NULL DEFAULT 0,   -- 직책수당
  meal_allowance       INTEGER NOT NULL DEFAULT 0,   -- 식대 (200,000 원까지 비과세)
  transport_allowance  INTEGER NOT NULL DEFAULT 0,   -- 차량유지비 (200,000 원까지 비과세)
  other_allowance      INTEGER NOT NULL DEFAULT 0,   -- 기타수당 (과세)
  dependents_count     INTEGER NOT NULL DEFAULT 1,   -- 부양가족 수 (본인 포함)
  kids_under_20        INTEGER NOT NULL DEFAULT 0,   -- 20세 이하 자녀 수
  bank_name            TEXT,                         -- 입금 은행
  bank_account         TEXT,                         -- 계좌번호 (표시용, 평문)
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Payroll periods — one row per YYYY-MM cycle.
-- draft → closed (잠금, 개별 명세서 수정 불가) → paid (지급 완료)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_periods (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  period_yyyymm  TEXT    NOT NULL UNIQUE,       -- '2026-04'
  pay_date       TEXT,                           -- YYYY-MM-DD
  status         TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed','paid')),
  note           TEXT,
  closed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at      TEXT,
  paid_at        TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Payslips — one row per (period, employee).
-- Stored as pre-computed amounts so past periods don't shift if tax rules change.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payslips (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id               INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employment_type         TEXT    NOT NULL CHECK (employment_type IN ('regular','freelancer','parttime')),
  -- Earnings (원)
  base_salary             INTEGER NOT NULL DEFAULT 0,
  overtime_pay            INTEGER NOT NULL DEFAULT 0,
  position_allowance      INTEGER NOT NULL DEFAULT 0,
  meal_allowance          INTEGER NOT NULL DEFAULT 0,
  transport_allowance     INTEGER NOT NULL DEFAULT 0,
  bonus                   INTEGER NOT NULL DEFAULT 0,
  other_taxable           INTEGER NOT NULL DEFAULT 0,   -- 기타과세
  other_nontaxable        INTEGER NOT NULL DEFAULT 0,   -- 기타비과세
  gross_pay               INTEGER NOT NULL DEFAULT 0,   -- 지급합계
  taxable_base            INTEGER NOT NULL DEFAULT 0,   -- 과세 대상
  -- Deductions (원)
  income_tax              INTEGER NOT NULL DEFAULT 0,   -- 갑근세
  local_income_tax        INTEGER NOT NULL DEFAULT 0,   -- 지방소득세 = income_tax * 10%
  national_pension        INTEGER NOT NULL DEFAULT 0,   -- 국민연금
  health_insurance        INTEGER NOT NULL DEFAULT 0,   -- 건강보험
  long_term_care          INTEGER NOT NULL DEFAULT 0,   -- 장기요양
  employment_insurance    INTEGER NOT NULL DEFAULT 0,   -- 고용보험
  freelancer_withholding  INTEGER NOT NULL DEFAULT 0,   -- 프리랜서 3.3%
  other_deduction         INTEGER NOT NULL DEFAULT 0,
  total_deduction         INTEGER NOT NULL DEFAULT 0,
  net_pay                 INTEGER NOT NULL DEFAULT 0,   -- 실수령액
  status                  TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed','paid')),
  memo                    TEXT,
  calc_version            INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (period_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_payslips_user ON payslips(user_id);
CREATE INDEX IF NOT EXISTS idx_payslips_period ON payslips(period_id);

-- ---------------------------------------------------------------------------
-- Corporate cards (법인 카드) — card inventory + holders + monthly statements.
-- Defined BEFORE subscriptions so recurring_subscriptions.card_id FK resolves
-- in strict-enforcement environments (sqlite is lenient but be explicit).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS corporate_cards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  alias         TEXT    NOT NULL UNIQUE,        -- e.g. '법인1 · 마케팅'
  brand         TEXT,                            -- 'Visa' / 'MasterCard' / '국내전용'
  issuer        TEXT,                            -- 발급사 (예: 신한카드)
  last4         TEXT    NOT NULL,                -- 끝 4자리 (전체 번호는 보관 X)
  holder_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- 실소지자
  owner_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL, -- 회계 담당
  monthly_limit  INTEGER NOT NULL DEFAULT 0,
  statement_day  INTEGER NOT NULL DEFAULT 1,    -- 결제일 (매월)
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','retired')),
  memo           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Recurring subscriptions (정기 결제) — SaaS / 구독 서비스 / 월간 리테이너 등
-- Defined BEFORE corporate_card_transactions to resolve the subscription_id FK.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurring_subscriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor         TEXT    NOT NULL,                -- 'Notion', '네이버 광고', ...
  plan           TEXT,                            -- 'Team (20 seats)'
  category       TEXT,                            -- 'SaaS','광고','유지보수',...
  amount         INTEGER NOT NULL DEFAULT 0,      -- 1회 결제 금액 (원, 원화 기준)
  currency       TEXT    NOT NULL DEFAULT 'KRW',
  cadence        TEXT    NOT NULL DEFAULT 'monthly' CHECK (cadence IN (
                   'monthly','yearly','quarterly','weekly','custom'
                 )),
  cadence_days   INTEGER,                         -- cadence = 'custom' 일 때 일수
  next_charge_at TEXT,                            -- 다음 결제 예정일 (YYYY-MM-DD)
  card_id        INTEGER REFERENCES corporate_cards(id) ON DELETE SET NULL,
  owner_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  started_at     TEXT,
  cancelled_at   TEXT,
  memo           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_status ON recurring_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_next   ON recurring_subscriptions(next_charge_at);

CREATE TABLE IF NOT EXISTS corporate_card_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL REFERENCES corporate_cards(id) ON DELETE CASCADE,
  spent_at      TEXT    NOT NULL,                -- ISO datetime
  merchant      TEXT    NOT NULL,                -- 가맹점
  category      TEXT,                            -- '식비','교통','소프트웨어','광고',...
  amount        INTEGER NOT NULL,                -- 원 (환불이면 음수)
  currency      TEXT    NOT NULL DEFAULT 'KRW',
  note          TEXT,
  subscription_id INTEGER REFERENCES recurring_subscriptions(id) ON DELETE SET NULL,
  receipt_path  TEXT,                            -- 영수증 첨부 경로 (선택)
  reconciled    INTEGER NOT NULL DEFAULT 0,      -- 대사 완료 여부
  actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corp_card_tx_card   ON corporate_card_transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_corp_card_tx_spent  ON corporate_card_transactions(spent_at);
CREATE INDEX IF NOT EXISTS idx_corp_card_tx_sub    ON corporate_card_transactions(subscription_id);

-- ===========================================================================
-- Student information archive (학생 정보 보관함)
--   - 노션에서 따온 파싱 결과는 기존 parsing_results 테이블을 재활용해서 조회만 함.
--   - 보고서 주제(어떤 학생이 어떤 보고서/수행평가 주제를 진행해왔는지)와
--     관련 파일(업로드된 보고서 원본/최종본)은 별도 테이블로 보관.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS student_report_topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,                -- 수행평가/보고서 제목
  subject       TEXT,                             -- 과목
  topic         TEXT,                             -- 구체 주제
  status        TEXT    NOT NULL DEFAULT 'planned' CHECK (status IN (
                  'planned','in_progress','submitted','graded','archived','cancelled'
                )),
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL, -- 연결된 과제 (있으면)
  due_at        TEXT,
  submitted_at  TEXT,
  score         TEXT,                             -- 자유 텍스트 (A+, 95/100 등)
  memo          TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_student_report_topics_student ON student_report_topics(student_id);
CREATE INDEX IF NOT EXISTS idx_student_report_topics_status  ON student_report_topics(status);

CREATE TABLE IF NOT EXISTS student_archive_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id      INTEGER REFERENCES student_report_topics(id) ON DELETE SET NULL,
  category      TEXT    NOT NULL DEFAULT 'report' CHECK (category IN (
                  'report','draft','reference','feedback','other'
                )),
  original_name TEXT    NOT NULL,
  stored_path   TEXT    NOT NULL,                 -- userData 내부 상대 경로 or 'local://<filename>'
  mime_type     TEXT,
  size_bytes    INTEGER,
  description   TEXT,
  -- 최종 승인(승인완료) 과제에서 자동 보관된 레코드일 경우, 원본 과제 id.
  -- 승인이 반려로 번복되면 이 값으로 찾아 자동 삭제한다.
  source_assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  auto_generated       INTEGER NOT NULL DEFAULT 0, -- 1 = 시스템이 자동 생성한 레코드 (수동 편집 금지)
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_student_archive_files_student ON student_archive_files(student_id);
CREATE INDEX IF NOT EXISTS idx_student_archive_files_topic   ON student_archive_files(topic_id);
CREATE INDEX IF NOT EXISTS idx_student_archive_files_source  ON student_archive_files(source_assignment_id);

-- ===========================================================================
-- Student grades (내신 성적) — 학기/과목 단위 구조화 저장
--   한 학생 × 한 학기 × 한 과목 = 한 행. 동일 3개 키 UNIQUE.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS student_grades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  grade_level   TEXT    NOT NULL,                 -- '중3', '고1', '고2', ...
  semester      TEXT    NOT NULL,                 -- '1학기','2학기','중간','기말' 등 자유 텍스트
  subject       TEXT    NOT NULL,                 -- '수학', '국어', ...
  score         TEXT,                              -- '1등급', '95점', 'A+' 자유 텍스트
  raw_score     REAL,                              -- 원점수 (선택, 숫자로 기록하고 싶을 때)
  memo          TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, grade_level, semester, subject)
);
CREATE INDEX IF NOT EXISTS idx_student_grades_student ON student_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_student_grades_term    ON student_grades(student_id, grade_level, semester);

-- ===========================================================================
-- Student counseling logs (상담 이력) — 날짜/제목/본문의 타임라인
-- ===========================================================================

CREATE TABLE IF NOT EXISTS student_counseling_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  log_date      TEXT    NOT NULL,                 -- YYYY-MM-DD
  title         TEXT    NOT NULL,
  body          TEXT,
  category      TEXT,                              -- '학부모','학생','진로','성적','행동' 등 자유
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_student_counseling_student ON student_counseling_logs(student_id, log_date DESC);
