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
import { syncAssignments as syncAssignmentsCore, type AssignmentRunSummary } from './notion/assignments';

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

const EXCLUDED_NOTION_STUDENT_CODES = new Set([
  'N-컨설-0205106D',
  'N-컨설-0456381C',
  'N-컨설-1D38BA09',
  'N-컨설-4D232616',
  'N-컨설-6193F5E9',
  'N-컨설-65C6D943',
  'N-컨설-864AC0C9',
  'N-컨설-9D7F99D3',
  'N-컨설-A4E1ED71',
  'N-컨설-A881426C',
  'N-컨설-C3DF61BD',
  'N-컨설-EEDEE887',
  'N-컨설-FF2A863E',
]);

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

function pickProperty(
  props: Record<string, unknown>,
  name?: string | null,
): unknown | undefined {
  const key = (name ?? '').trim();
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(props, key)) return props[key];
  const lowered = key.toLowerCase();
  return Object.entries(props).find(
    ([candidate]) => candidate.trim().toLowerCase() === lowered,
  )?.[1];
}


function readConfiguredText(
  props: Record<string, unknown>,
  configured: string | undefined,
  fallbacks: string[],
): string {
  const names = configured ? [configured, ...fallbacks] : fallbacks;
  for (const name of names) {
    const value = readText(pickProperty(props, name));
    if (value) return value.trim();
  }
  return '';
}


function readFirstTitle(props: Record<string, unknown>): string {
  for (const raw of Object.values(props)) {
    const prop = raw as { type?: string } | null;
    if (prop?.type === 'title') {
      const value = readText(prop);
      if (value) return value;
    }
  }
  return '';
}


function pickContact(page: NotionPage, fieldName?: string): string {
  if (fieldName) {
    const configured = readText(pickProperty(page.properties ?? {}, fieldName));
    if (configured) return configured;
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
    readConfiguredText(props, undefined, [
      '이름',
      '학생명',
      '학생',
      '성명',
      'Name',
      'name',
      'Title',
      'title',
    ]) || readFirstTitle(props);
  if (!name) return 'skipped';

  const school = readConfiguredText(props, undefined, [
    '학교',
    '학교명',
    'School',
    'school',
  ]);
  const grade = readConfiguredText(props, undefined, [
    '학년',
    'Grade',
    'grade',
  ]);
  const contact =
    pickContact(page, fieldCfg.contactField) ||
    readConfiguredText(props, undefined, [
      '학생 연락처',
      '연락처',
      '전화번호',
      '휴대폰',
      'Phone',
      'phone',
    ]);
  const guardianPhone =
    pickContact(page, fieldCfg.guardianField) ||
    readConfiguredText(props, undefined, [
      '학부모 연락처',
      '보호자 연락처',
      '학부모 전화번호',
      '연락처(모)',
      '연락처(부)',
      'Guardian Phone',
      'guardianPhone',
    ]);
  const status = readConfiguredText(props, undefined, [
    '진행상황',
    '진행 상황',
    '상태',
    'Status',
    'status',
  ]);
  const memoParts: string[] = [];
  if (status) memoParts.push(`상태:${status}`);
  if (contact) memoParts.push(`학생:${contact}`);
  const career = readConfiguredText(props, undefined, ['진로', '희망 진로', 'Career']);
  const note = readConfiguredText(props, undefined, ['특이사항', '메모', 'Note']);
  const group = readConfiguredText(props, undefined, ['편성', '반', 'Class']);
  const branch = readConfiguredText(props, undefined, ['지점', '캠퍼스', 'Branch']);
  if (career) memoParts.push(`진로:${career}`);
  if (note) memoParts.push(`특이:${note}`);
  if (group) memoParts.push(`편성:${group}`);
  if (branch) memoParts.push(`지점:${branch}`);
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
  const byIdentity = existing
    ? undefined
    : (db
        .prepare(
          `SELECT id, student_code, notion_page_id
             FROM students
            WHERE name = ?
              AND IFNULL(school, '') = IFNULL(?, '')
            ORDER BY deleted_at IS NULL DESC, id ASC
            LIMIT 1`,
        )
        .get(name, school || null) as StudentRow | undefined);

  if (existing || byIdentity) {
    const target = existing ?? byIdentity!;
    if (EXCLUDED_NOTION_STUDENT_CODES.has(target.student_code)) return 'skipped';
    db.prepare(
      `UPDATE students
          SET name = ?,
              grade = ?,
              school = ?,
              phone = CASE WHEN IFNULL(phone, '') = '' THEN ? ELSE phone END,
              guardian = CASE WHEN IFNULL(guardian, '') = '' THEN ? ELSE guardian END,
              guardian_phone = CASE WHEN IFNULL(guardian_phone, '') = '' THEN ? ELSE guardian_phone END,
              memo = ?,
              notion_source = ?,
              notion_synced_at = datetime('now'),
              notion_page_id = ?,
              notion_extra = ?,
              deleted_at = NULL
        WHERE id = ?`,
    ).run(
      name,
      grade || null,
      school || null,
      contact || null,
      guardianPhone || null,
      guardianPhone || null,
      memo,
      sourceLabel,
      page.id,
      extraJson,
      target.id,
    );
    return 'updated';
  }

  // 신규 — student_code 자동 생성 (이미 있다면 2~3회 suffix 회전)
  const base = `N-${sourceLabel.slice(0, 2).toUpperCase() || 'NO'}-${shortId(page.id)}`;
  if (EXCLUDED_NOTION_STUDENT_CODES.has(base)) return 'skipped';
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
       (student_code, name, grade, school, phone, guardian, guardian_phone, memo,
        notion_page_id, notion_source, notion_synced_at, notion_extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(
    code,
    name,
    grade || null,
    school || null,
    contact || null,
    guardianPhone || null,
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
  const byName = db.prepare(
    `SELECT id, email, notion_user_id FROM users
      WHERE lower(trim(name)) = lower(trim(?))
      ORDER BY active DESC, id ASC
      LIMIT 1`,
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
      const name = u.name ?? '';
      const existing = (email
        ? byEmail.get(email)
        : undefined) as
        | { id: number; email: string; notion_user_id: string | null }
        | undefined;
      const fallback = !existing && name
        ? (byName.get(name) as
            | { id: number; email: string; notion_user_id: string | null }
            | undefined)
        : undefined;
      const matched = existing ?? fallback;
      if (!matched) {
        // 시스템에 없는 직원은 건너뛴다 (HR_ADMIN 이 수동으로 계정 생성해야 함).
        skipped += 1;
        continue;
      }
      updateStmt.run(u.id, matched.id);
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
        : `직원 ${updated}명에 노션 ID 연결 (조회 ${users.length}, 건너뜀 ${skipped})`,
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
// ??? Notion DB ???? ?? ??? ??.
export async function syncAssignments(
  db: Db,
  actorId?: number | null,
): Promise<AssignmentRunSummary & { runId: number }> {
  return syncAssignmentsCore(db, actorId, { getNotionSettings, writeRun });
}

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
