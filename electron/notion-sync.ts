/**
 * Notion → EduOps 동기화 오케스트레이터.
 *
 * 책임:
 *   1) admin_settings 에서 Notion 토큰/DB 목록/필드 매핑을 읽는다.
 *   2) NotionClient 로 각 DB를 쿼리 + users.list 를 호출.
 *   3) SQLite `students` / `users` 테이블에 idempotent 하게 upsert.
 *   4) `notion_sync_runs` 에 실행 결과를 1행 남긴다.
 *
 * 설계 원칙:
 *   - 학생 upsert 키: `notion_page_id`. 동일 페이지가 다시 오면 UPDATE,
 *     처음 보는 페이지면 INSERT. 이때 `student_code` 는 `N-<short>` 로
 *     자동 생성 (기존 수동 student_code 와 충돌하지 않도록 접두사 보장).
 *   - 직원(users) 동기화는 *신규 생성하지 않는다*. 이미 시스템에 존재하는
 *     계정(이메일 매칭)에만 `notion_user_id` 를 붙여 준다 — 비밀번호·권한
 *     관리는 HR_ADMIN 전용이므로 자동 생성은 의도적으로 차단.
 *   - 매핑되지 않은 노션 프로퍼티는 `notion_extra` (JSON) 에 백업 저장.
 */

import type { Database as Db } from 'better-sqlite3';
import { getDb } from './db';
import {
  NotionClient,
  flattenProperties,
  readText,
  type NotionPage,
  type NotionUser,
} from './notion-client';

// ---------------------------------------------------------------------------
// 설정 I/O
// ---------------------------------------------------------------------------

export interface NotionSettings {
  token: string;
  studentDatabases: Array<{
    id: string;           // notion database id (dash 포함 여부 무관)
    label?: string;       // 예: "컨설팅", "수행/세특", "구미호"
    // 해당 DB 고유의 연락처 필드 이름 (optional). 미지정 시 기본 매핑 사용.
    contactField?: string;
    guardianField?: string;
  }>;
  assignmentDatabases: Array<{
    id: string;           // "컨설팅 과제 의뢰" 등 과제 요청 DB 의 id
    label?: string;       // 예: "컨설팅 과제 의뢰"
    // 과제 요청 DB 에 사용되는 프로퍼티 이름 (기본값이 있으므로 선택 입력).
    subjectField?: string;   // 과목명
    titleField?: string;     // 보고서 주제 / 과제 이름
    statusField?: string;    // 진행 상황
    parserField?: string;    // 작성자
    qa1Field?: string;       // 1차 검수자
    qaFinalField?: string;   // 2차 작성자 / 최종 검수
    dueField?: string;       // 마감시한
  }>;
}

const DEFAULT_STUDENT_DATABASES: NotionSettings['studentDatabases'] = [
  {
    id: '31de037ff1e98045a103ddb435ce95a0',
    label: '컨설팅',
    contactField: '학생 연락처',
    guardianField: '학부모 연락처',
  },
  {
    id: '2f2e037ff1e980c0adf8e88524ec28af',
    label: '수행/세특',
    guardianField: '연락처(모)',
  },
  {
    id: '2f2e037ff1e98062a13ce01d7991ee93',
    label: '구미호',
    guardianField: '연락처',
  },
];

const DEFAULT_ASSIGNMENT_DATABASES: NotionSettings['assignmentDatabases'] = [
  {
    id: '1a8e037ff1e9803ab169ea8e4688d1e0',
    label: '컨설팅 과제 의뢰',
    subjectField: '과목명',
    titleField: '✏️보고서 주제',
    statusField: '진행 상황',
    parserField: '작성자',
    qa1Field: '1차 검수자',
    qaFinalField: '2차 작성자',
    dueField: '마감시한 (zap)',
  },
];

function readAdminSetting(db: Db, key: string): unknown | null {
  const row = db
    .prepare(`SELECT value_json FROM admin_settings WHERE key = ?`)
    .get(key) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function writeAdminSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(key, JSON.stringify(value ?? null));
}

export function getNotionSettings(db: Db): NotionSettings {
  const token = (readAdminSetting(db, 'notion.token') as string | null) ?? '';
  const dbsRaw = readAdminSetting(db, 'notion.studentDatabases') as
    | NotionSettings['studentDatabases']
    | null;
  const asgRaw = readAdminSetting(db, 'notion.assignmentDatabases') as
    | NotionSettings['assignmentDatabases']
    | null;
  return {
    token: typeof token === 'string' ? token : '',
    studentDatabases:
      Array.isArray(dbsRaw) && dbsRaw.length > 0
        ? dbsRaw
        : DEFAULT_STUDENT_DATABASES,
    assignmentDatabases:
      Array.isArray(asgRaw) && asgRaw.length > 0
        ? asgRaw
        : DEFAULT_ASSIGNMENT_DATABASES,
  };
}

export function saveNotionSettings(
  db: Db,
  patch: Partial<NotionSettings>,
): NotionSettings {
  const current = getNotionSettings(db);
  const next: NotionSettings = {
    token: patch.token !== undefined ? patch.token : current.token,
    studentDatabases:
      patch.studentDatabases !== undefined
        ? patch.studentDatabases
        : current.studentDatabases,
    assignmentDatabases:
      patch.assignmentDatabases !== undefined
        ? patch.assignmentDatabases
        : current.assignmentDatabases,
  };
  writeAdminSetting(db, 'notion.token', next.token ?? '');
  writeAdminSetting(db, 'notion.studentDatabases', next.studentDatabases);
  writeAdminSetting(db, 'notion.assignmentDatabases', next.assignmentDatabases);
  return next;
}

// ---------------------------------------------------------------------------
// 실행 이력 기록
// ---------------------------------------------------------------------------

interface RunSummary {
  kind: 'students' | 'staff' | 'probe' | 'assignments';
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  message?: string;
  triggeredBy?: number | null;
}

function writeRun(db: Db, startedAt: string, s: RunSummary): number {
  const info = db
    .prepare(
      `INSERT INTO notion_sync_runs
         (kind, started_at, finished_at, ok, inserted, updated, skipped, errors, message, triggered_by)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.kind,
      startedAt,
      s.ok ? 1 : 0,
      s.inserted,
      s.updated,
      s.skipped,
      s.errors,
      s.message ?? null,
      s.triggeredBy ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function listRuns(
  db: Db,
  options: { limit?: number; kind?: RunSummary['kind'] } = {},
) {
  const lim = Math.min(Math.max(options.limit ?? 30, 1), 200);
  if (options.kind) {
    return db
      .prepare(
        `SELECT id, kind, started_at, finished_at, ok, inserted, updated,
                skipped, errors, message, triggered_by
           FROM notion_sync_runs
          WHERE kind = ?
          ORDER BY started_at DESC
          LIMIT ${lim}`,
      )
      .all(options.kind);
  }
  return db
    .prepare(
      `SELECT id, kind, started_at, finished_at, ok, inserted, updated,
              skipped, errors, message, triggered_by
         FROM notion_sync_runs
        ORDER BY started_at DESC
        LIMIT ${lim}`,
    )
    .all();
}

// ---------------------------------------------------------------------------
// 프로브 — 토큰 유효성 확인
// ---------------------------------------------------------------------------

export async function probe(
  db: Db,
  actorId?: number | null,
): Promise<{ ok: true; me: NotionUser } | { ok: false; message: string }> {
  const { token } = getNotionSettings(db);
  if (!token) {
    writeRun(db, new Date().toISOString(), {
      kind: 'probe',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: '토큰이 설정되지 않았습니다.',
      triggeredBy: actorId ?? null,
    });
    return { ok: false, message: '토큰이 설정되지 않았습니다.' };
  }
  const started = new Date().toISOString();
  try {
    const client = new NotionClient(token);
    const me = await client.probe();
    writeRun(db, started, {
      kind: 'probe',
      ok: true,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      message: `OK · ${me?.name ?? me?.id ?? '?'}`,
      triggeredBy: actorId ?? null,
    });
    return { ok: true, me };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRun(db, started, {
      kind: 'probe',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message,
      triggeredBy: actorId ?? null,
    });
    return { ok: false, message };
  }
}

// ---------------------------------------------------------------------------
// 학생 동기화
// ---------------------------------------------------------------------------

function shortId(pageId: string): string {
  return pageId.replace(/-/g, '').slice(-8).toUpperCase();
}

function pickContact(page: NotionPage, fieldName?: string): string {
  if (fieldName && page.properties[fieldName]) {
    return readText(page.properties[fieldName]);
  }
  return '';
}

interface StudentRow {
  id: number;
  student_code: string;
  notion_page_id: string | null;
}

function upsertStudentFromPage(
  db: Db,
  page: NotionPage,
  sourceLabel: string,
  fieldCfg: { contactField?: string; guardianField?: string },
): 'inserted' | 'updated' | 'skipped' {
  const props = page.properties ?? {};
  const name =
    readText(props['이름']) || readText(props['Name']) || readText(props['name']);
  if (!name) return 'skipped';

  const school = readText(props['학교']);
  const grade = readText(props['학년']);
  const contact = pickContact(page, fieldCfg.contactField);
  const guardianPhone = pickContact(page, fieldCfg.guardianField);
  const status = readText(props['진행상황']) || readText(props['상태']);
  const memoParts: string[] = [];
  if (status) memoParts.push(`상태:${status}`);
  if (contact) memoParts.push(`학생:${contact}`);
  if (readText(props['진로'])) memoParts.push(`진로:${readText(props['진로'])}`);
  if (readText(props['특이사항']))
    memoParts.push(`특이:${readText(props['특이사항'])}`);
  if (readText(props['편성'])) memoParts.push(`편성:${readText(props['편성'])}`);
  if (readText(props['지점'])) memoParts.push(`지점:${readText(props['지점'])}`);
  const memo = memoParts.join(' · ') || null;
  const extraJson = JSON.stringify({
    source: sourceLabel,
    notionUrl: page.url ?? null,
    properties: flattenProperties(props),
  });

  const existing = db
    .prepare(
      `SELECT id, student_code, notion_page_id
         FROM students
        WHERE notion_page_id = ?
        LIMIT 1`,
    )
    .get(page.id) as StudentRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE students
          SET name = ?,
              grade = ?,
              school = ?,
              guardian = ?,
              memo = ?,
              notion_source = ?,
              notion_synced_at = datetime('now'),
              notion_extra = ?,
              deleted_at = NULL
        WHERE id = ?`,
    ).run(name, grade || null, school || null, guardianPhone || null, memo, sourceLabel, extraJson, existing.id);
    return 'updated';
  }

  // 신규 — student_code 자동 생성 (이미 있다면 2~3회 suffix 회전)
  const base = `N-${sourceLabel.slice(0, 2).toUpperCase() || 'NO'}-${shortId(page.id)}`;
  let code = base;
  for (let i = 1; i < 5; i += 1) {
    const dup = db
      .prepare(`SELECT 1 FROM students WHERE student_code = ? LIMIT 1`)
      .get(code);
    if (!dup) break;
    code = `${base}-${i}`;
  }

  db.prepare(
    `INSERT INTO students
       (student_code, name, grade, school, guardian, memo,
        notion_page_id, notion_source, notion_synced_at, notion_extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(
    code,
    name,
    grade || null,
    school || null,
    guardianPhone || null,
    memo,
    page.id,
    sourceLabel,
    extraJson,
  );
  return 'inserted';
}

export async function syncStudents(
  db: Db,
  actorId?: number | null,
): Promise<RunSummary & { runId: number }> {
  const { token, studentDatabases } = getNotionSettings(db);
  const started = new Date().toISOString();
  if (!token) {
    const runId = writeRun(db, started, {
      kind: 'students',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: '토큰이 설정되지 않았습니다.',
      triggeredBy: actorId ?? null,
    });
    return {
      runId,
      kind: 'students',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: '토큰이 설정되지 않았습니다.',
      triggeredBy: actorId ?? null,
    };
  }

  const client = new NotionClient(token);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  for (const cfg of studentDatabases) {
    try {
      const pages = await client.queryAllPages(cfg.id, 1000);
      // 한 DB 분량은 한 트랜잭션으로 묶음 → 부분 실패 시 해당 DB만 롤백
      db.transaction((list: NotionPage[]) => {
        for (const page of list) {
          try {
            const result = upsertStudentFromPage(
              db,
              page,
              cfg.label ?? cfg.id.slice(0, 8),
              { contactField: cfg.contactField, guardianField: cfg.guardianField },
            );
            if (result === 'inserted') inserted += 1;
            else if (result === 'updated') updated += 1;
            else skipped += 1;
          } catch (pageErr) {
            errors += 1;
            const msg = pageErr instanceof Error ? pageErr.message : String(pageErr);
            errorMessages.push(`[${cfg.label ?? cfg.id}] ${page.id}: ${msg}`);
          }
        }
      })(pages);
    } catch (dbErr) {
      errors += 1;
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      errorMessages.push(`[${cfg.label ?? cfg.id}] query 실패: ${msg}`);
    }
  }

  const summary: RunSummary = {
    kind: 'students',
    ok: errors === 0,
    inserted,
    updated,
    skipped,
    errors,
    message:
      errorMessages.length > 0
        ? errorMessages.slice(0, 5).join(' | ')
        : `학생 ${inserted + updated}건 반영 (신규 ${inserted}, 갱신 ${updated}, 건너뜀 ${skipped})`,
    triggeredBy: actorId ?? null,
  };
  const runId = writeRun(db, started, summary);
  return { ...summary, runId };
}

// ---------------------------------------------------------------------------
// 직원(staff) 동기화 — 기존 계정에 notion_user_id 만 붙인다.
// ---------------------------------------------------------------------------

export async function syncStaff(
  db: Db,
  actorId?: number | null,
): Promise<RunSummary & { runId: number }> {
  const { token } = getNotionSettings(db);
  const started = new Date().toISOString();
  if (!token) {
    const runId = writeRun(db, started, {
      kind: 'staff',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: '토큰이 설정되지 않았습니다.',
      triggeredBy: actorId ?? null,
    });
    return {
      runId,
      kind: 'staff',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: '토큰이 설정되지 않았습니다.',
      triggeredBy: actorId ?? null,
    };
  }

  const client = new NotionClient(token);
  let inserted = 0; // 스태프는 자동 insert 하지 않으므로 0 유지
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  let users: NotionUser[] = [];
  try {
    users = await client.listAllUsers(500);
  } catch (err) {
    errors += 1;
    errorMessages.push(err instanceof Error ? err.message : String(err));
  }

  const byEmail = db.prepare(
    `SELECT id, email, notion_user_id FROM users WHERE lower(email) = lower(?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE users
        SET notion_user_id = ?,
            notion_synced_at = datetime('now')
      WHERE id = ?`,
  );

  db.transaction((list: NotionUser[]) => {
    for (const u of list) {
      if (u.type !== 'person') {
        skipped += 1;
        continue;
      }
      const email = u.person?.email ?? '';
      if (!email) {
        skipped += 1;
        continue;
      }
      const existing = byEmail.get(email) as
        | { id: number; email: string; notion_user_id: string | null }
        | undefined;
      if (!existing) {
        // 시스템에 없는 직원은 건너뛴다 (HR_ADMIN 이 수동으로 계정 생성해야 함).
        skipped += 1;
        continue;
      }
      updateStmt.run(u.id, existing.id);
      updated += 1;
    }
  })(users);

  const summary: RunSummary = {
    kind: 'staff',
    ok: errors === 0,
    inserted,
    updated,
    skipped,
    errors,
    message:
      errorMessages.length > 0
        ? errorMessages.slice(0, 5).join(' | ')
        : `직원 ${updated}명에 노션 ID 연결 (건너뜀 ${skipped})`,
    triggeredBy: actorId ?? null,
  };
  const runId = writeRun(db, started, summary);
  return { ...summary, runId };
}

// ---------------------------------------------------------------------------
// 과제 동기화 — "컨설팅 과제 의뢰" 스타일 Notion DB → assignments + students
// ---------------------------------------------------------------------------

/**
 * 노션 "진행 상황" (13개) → EduOps assignments.state (16개) 매핑.
 * 매핑되지 않는 문자열은 '신규접수' 로 처리. 공백 제거 후 비교.
 */
const NOTION_STATUS_MAP: Record<string, string> = {
  '착수 전': '신규접수',
  '재작업/2차 작업': '수정요청',
  '초안': '파싱완료',
  '진행중': '파싱진행중',
  '검수 중 (1차)': '1차QA진행중',
  '1차 검수 완료': '최종QA대기',
  '최종 검수 중': '최종QA진행중',
  '최종 검수 중 (혜은)': '최종QA진행중',
  '초안 전달': '완료',
  '수정 필요': '수정요청',
  '수정 완료': '완료',
  '반려': '최종QA반려',
  '보류': '보류',
};

function mapNotionStatusToState(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '신규접수';
  return NOTION_STATUS_MAP[s] ?? '신규접수';
}

/** Notion people/select 필드의 담당자 이름을 users.id 로 바꾸는 헬퍼. */
function resolveUserByName(db: Db, rawName: string): number | null {
  const name = (rawName ?? '').trim();
  if (!name) return null;
  // 정확 매칭 우선, 없으면 대소문자 무시 LIKE.
  const exact = db
    .prepare(`SELECT id FROM users WHERE name = ? LIMIT 1`)
    .get(name) as { id: number } | undefined;
  if (exact) return exact.id;
  const loose = db
    .prepare(
      `SELECT id FROM users
         WHERE lower(trim(name)) = lower(trim(?))
         LIMIT 1`,
    )
    .get(name) as { id: number } | undefined;
  return loose?.id ?? null;
}

/**
 * Notion date property 를 ISO 문자열(UTC)로 변환. start 만 사용.
 * 날짜 전용(시간 없음)이면 자정 UTC 로 해석.
 */
function readDateIso(prop: any): string | null {
  if (!prop || prop.type !== 'date' || !prop.date?.start) return null;
  const raw = String(prop.date.start);
  // Notion 이 보내는 포맷은 YYYY-MM-DD 또는 ISO(오프셋 포함).
  // Date 파싱이 실패하면 원본을 그대로 저장.
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : raw;
}

/**
 * Notion file 속성을 평탄화된 URL 배열로 추출 — 외부 URL + 업로드 파일 모두.
 * Notion 이 반환하는 presigned URL 은 1시간 후 만료되므로 여기서는 단순 보관용.
 */
function readFileUrls(prop: any): Array<{ name: string; url: string; expires?: string }> {
  if (!prop || prop.type !== 'files' || !Array.isArray(prop.files)) return [];
  const out: Array<{ name: string; url: string; expires?: string }> = [];
  for (const f of prop.files) {
    if (!f) continue;
    const name = String(f.name ?? '');
    if (f.type === 'external' && f.external?.url) {
      out.push({ name, url: String(f.external.url) });
    } else if (f.type === 'file' && f.file?.url) {
      out.push({
        name,
        url: String(f.file.url),
        expires: f.file.expiry_time ? String(f.file.expiry_time) : undefined,
      });
    }
  }
  return out;
}

/**
 * (name, school, grade) 로 기존 학생을 찾아 재사용. 없으면 새로 만든다.
 * 과제 요청 DB 는 "한 행 = 한 과제" 이므로 동일 학생이 여러 번 나타날 수
 * 있음 — upsert 키는 자연키 3종 세트.
 */
function upsertStudentNaturalKey(
  db: Db,
  opts: {
    name: string;
    school: string | null;
    grade: string | null;
    phone: string | null;
    guardianPhone: string | null;
    sourceLabel: string;
    notionPageId: string; // assignment page id — 학생 identity 에는 쓰지 않고 fallback code 생성에만 사용
    extraProps: Record<string, string>;
  },
): number | null {
  const { name, school, grade, phone, guardianPhone, sourceLabel } = opts;
  if (!name.trim()) return null;

  const byNatural = db
    .prepare(
      `SELECT id FROM students
         WHERE name = ?
           AND IFNULL(school, '') = IFNULL(?, '')
           AND IFNULL(grade,  '') = IFNULL(?, '')
         ORDER BY deleted_at IS NULL DESC, id ASC
         LIMIT 1`,
    )
    .get(name.trim(), school, grade) as { id: number } | undefined;

  if (byNatural) {
    // 연락처/학부모 번호는 비어 있는 경우에만 갱신 (기존 데이터 파괴 방지).
    db.prepare(
      `UPDATE students
          SET phone = CASE WHEN IFNULL(phone, '') = '' THEN ? ELSE phone END,
              guardian_phone = CASE WHEN IFNULL(guardian_phone, '') = '' THEN ? ELSE guardian_phone END,
              notion_source = COALESCE(notion_source, ?),
              notion_synced_at = datetime('now'),
              deleted_at = NULL
        WHERE id = ?`,
    ).run(phone, guardianPhone, sourceLabel, byNatural.id);
    return byNatural.id;
  }

  // 신규 — N-<label2>-<shortOfAssignmentPage> 로 코드 생성, 충돌 시 suffix.
  const base = `N-${sourceLabel.slice(0, 2).toUpperCase() || 'NO'}-${shortId(opts.notionPageId)}`;
  let code = base;
  for (let i = 1; i < 6; i += 1) {
    const dup = db
      .prepare(`SELECT 1 FROM students WHERE student_code = ? LIMIT 1`)
      .get(code);
    if (!dup) break;
    code = `${base}-${i}`;
  }

  const extraJson = JSON.stringify({
    source: sourceLabel,
    via: 'assignments-sync',
    properties: opts.extraProps,
  });

  const info = db
    .prepare(
      `INSERT INTO students
         (student_code, name, grade, school, phone, guardian_phone,
          notion_source, notion_synced_at, notion_extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    )
    .run(code, name.trim(), grade, school, phone, guardianPhone, sourceLabel, extraJson);
  return Number(info.lastInsertRowid);
}

/** 다음 `code` 값을 결정. 충돌 시 suffix 회전. */
function nextAssignmentCode(db: Db, base: string): string {
  let code = base;
  for (let i = 1; i < 6; i += 1) {
    const dup = db
      .prepare(`SELECT 1 FROM assignments WHERE code = ? LIMIT 1`)
      .get(code);
    if (!dup) break;
    code = `${base}-${i}`;
  }
  return code;
}

interface AssignmentDbCfg {
  id: string;
  label?: string;
  subjectField?: string;
  titleField?: string;
  statusField?: string;
  parserField?: string;
  qa1Field?: string;
  qaFinalField?: string;
  dueField?: string;
}

interface NotionFileRef {
  name: string;
  url: string;
  expires?: string;
  kind: 'draft' | 'final' | 'attachment';
}

interface AssignmentUpsertResult {
  status: 'inserted' | 'updated' | 'skipped';
  assignmentId?: number;
  studentId?: number | null;
  files: NotionFileRef[];
}

function safeFilename(name: string, fallback: string): string {
  const cleaned = (name || fallback)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

// ---------------------------------------------------------------------------
// 과제 동기화 — TODO(v0.1.10): 현재는 스텁. 파일 레퍼런스 저장/다운로드 및
// 학생/담당자 연결은 별도 PR에서 복원. v0.1.9 는 보안 핸들러 가드가 주목적.
// ---------------------------------------------------------------------------
export async function syncAssignments(
  db: Db,
  actorId?: number | null,
): Promise<RunSummary & { runId: number }> {
  const started = new Date().toISOString();
  const summary: RunSummary = {
    kind: 'assignments',
    ok: false,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 1,
    message: '과제 동기화는 v0.1.10 에서 재구현 예정입니다.',
    triggeredBy: actorId ?? null,
  };
  const runId = writeRun(db, started, summary);
  // safeFilename / nextAssignmentCode / resolveUserByName / readDateIso /
  // readFileUrls / upsertStudentNaturalKey / mapNotionStatusToState 는
  // syncAssignments 재구현 시 재사용하기 위해 파일에 남겨 두었습니다.
  void safeFilename;
  void nextAssignmentCode;
  void resolveUserByName;
  void readDateIso;
  void readFileUrls;
  void upsertStudentNaturalKey;
  void mapNotionStatusToState;
  // 또한 AssignmentDbCfg / NotionFileRef / AssignmentUpsertResult 타입 역시
  // 현재 미사용이지만 동일한 이유로 남겨 둡니다.
  type _Cfg = AssignmentDbCfg;
  type _Ref = NotionFileRef;
  type _Res = AssignmentUpsertResult;
  void (null as unknown as _Cfg | _Ref | _Res);
  return { ...summary, runId };
}

// ---------------------------------------------------------------------------
// 외부에서 단일 네임스페이스로 호출하기 위한 진입점 모음. ipc.ts 가
// `import { NotionSync } from './notion-sync'` 로 참조합니다.
// ---------------------------------------------------------------------------
export const NotionSync = {
  getSettings: () => getNotionSettings(getDb()),
  saveSettings: (patch: Partial<NotionSettings>) =>
    saveNotionSettings(getDb(), patch),
  probe: (actorId?: number | null) => probe(getDb(), actorId),
  syncStudents: (actorId?: number | null) => syncStudents(getDb(), actorId),
  syncStaff: (actorId?: number | null) => syncStaff(getDb(), actorId),
  syncAssignments: (actorId?: number | null) => syncAssignments(getDb(), actorId),
  listRuns: (opts?: { limit?: number; kind?: RunSummary['kind'] }) => listRuns(getDb(), opts),
};
