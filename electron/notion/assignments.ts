import type { Database as Db } from 'better-sqlite3';
import {
  NotionClient,
  flattenProperties,
  readText,
  type NotionPage,
} from '../notion-client';
import { syncNotionAssignmentArchiveFiles } from './archive-files';

export interface AssignmentRunSummary {
  kind: 'assignments';
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  message?: string;
  triggeredBy?: number | null;
}

interface AssignmentSyncDeps {
  getNotionSettings: (db: Db) => { token: string; assignmentDatabases: AssignmentDbCfg[] };
  writeRun: (db: Db, startedAt: string, summary: AssignmentRunSummary) => number;
}

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

function shortId(pageId: string): string {
  return pageId.replace(/-/g, '').slice(-8).toUpperCase();
}

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
 * (name, school) 로 기존 학생을 찾아 재사용한다. 학년만 달라진 행은
 * 같은 학생으로 취급한다.
 * 과제 요청 DB 는 "한 행 = 한 과제" 이므로 동일 학생이 여러 번 나타날 수
 * 있음 — 학년은 업데이트 대상일 뿐 학생 identity 에는 쓰지 않는다.
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
      `SELECT id, student_code FROM students
         WHERE name = ?
           AND IFNULL(school, '') = IFNULL(?, '')
         ORDER BY deleted_at IS NULL DESC, id ASC
         LIMIT 1`,
    )
    .get(name.trim(), school) as { id: number; student_code: string } | undefined;

  if (byNatural) {
    if (EXCLUDED_NOTION_STUDENT_CODES.has(byNatural.student_code)) return null;
    // 연락처/학부모 번호는 비어 있는 경우에만 갱신 (기존 데이터 파괴 방지).
    db.prepare(
      `UPDATE students
          SET phone = CASE WHEN IFNULL(phone, '') = '' THEN ? ELSE phone END,
              guardian_phone = CASE WHEN IFNULL(guardian_phone, '') = '' THEN ? ELSE guardian_phone END,
              grade = CASE WHEN IFNULL(grade, '') = '' THEN ? ELSE grade END,
              notion_source = COALESCE(notion_source, ?),
              notion_synced_at = datetime('now'),
              deleted_at = NULL
        WHERE id = ?`,
    ).run(phone, guardianPhone, grade, sourceLabel, byNatural.id);
    return byNatural.id;
  }

  // 신규 — N-<label2>-<shortOfAssignmentPage> 로 코드 생성, 충돌 시 suffix.
  const base = `N-${sourceLabel.slice(0, 2).toUpperCase() || 'NO'}-${shortId(opts.notionPageId)}`;
  if (EXCLUDED_NOTION_STUDENT_CODES.has(base)) return null;
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

function readConfiguredDate(
  props: Record<string, unknown>,
  configured: string | undefined,
  fallbacks: string[],
): string | null {
  const names = configured ? [configured, ...fallbacks] : fallbacks;
  for (const name of names) {
    const value = readDateIso(pickProperty(props, name));
    if (value) return value;
  }
  return null;
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

function readStudentCode(db: Db, studentId: number | null): string | null {
  if (!studentId) return null;
  const row = db
    .prepare(`SELECT student_code FROM students WHERE id = ? LIMIT 1`)
    .get(studentId) as { student_code: string } | undefined;
  return row?.student_code ?? null;
}

function collectFiles(props: Record<string, unknown>): NotionFileRef[] {
  const files: NotionFileRef[] = [];
  for (const [propName, raw] of Object.entries(props)) {
    const lowered = propName.toLowerCase();
    const kind: NotionFileRef['kind'] =
      lowered.includes('final') || propName.includes('최종')
        ? 'final'
        : lowered.includes('draft') || propName.includes('초안')
          ? 'draft'
          : 'attachment';
    for (const file of readFileUrls(raw)) {
      files.push({
        ...file,
        name: safeFilename(file.name, `${propName}-${files.length + 1}`),
        kind,
      });
    }
  }
  return files;
}

function buildNotionParsingPayload(input: {
  sourceLabel: string;
  page: NotionPage;
  flatProps: Record<string, string>;
  files: NotionFileRef[];
  subject: string;
  title: string;
  scope: string | null;
  lengthReq: string | null;
  outline: string | null;
  rubric: string | null;
  teacherReq: string | null;
  studentReq: string | null;
}): string {
  return JSON.stringify({
    sourceKind: 'notion-sync',
    source: input.sourceLabel,
    notionPageId: input.page.id,
    notionUrl: input.page.url ?? null,
    subject: input.subject,
    assignmentTitle: input.title,
    assignmentScope: input.scope,
    lengthRequirement: input.lengthReq,
    outline: input.outline,
    rubric: input.rubric,
    teacherRequirements: input.teacherReq,
    studentRequests: input.studentReq,
    files: input.files,
    properties: input.flatProps,
  });
}

function syncNotionParsingSnapshot(
  db: Db,
  assignmentId: number,
  contentJson: string,
  actorId: number | null,
): void {
  const latest = db
    .prepare(
      `SELECT id, version, content_json
         FROM parsing_results
        WHERE assignment_id = ?
        ORDER BY version DESC
        LIMIT 1`,
    )
    .get(assignmentId) as
    | { id: number; version: number; content_json: string }
    | undefined;

  if (!latest) {
    db.prepare(
      `INSERT INTO parsing_results
         (assignment_id, version, content_json, ai_summary, confidence, parsed_by)
       VALUES (?, 1, ?, ?, NULL, ?)`,
    ).run(
      assignmentId,
      contentJson,
      'Notion 과제 DB에서 동기화된 원본 속성입니다.',
      actorId,
    );
    return;
  }

  try {
    const parsed = JSON.parse(latest.content_json) as { sourceKind?: string };
    if (parsed.sourceKind !== 'notion-sync') return;
  } catch {
    return;
  }

  db.prepare(
    `UPDATE parsing_results
        SET content_json = ?,
            ai_summary = ?,
            parsed_by = ?,
            parsed_at = datetime('now')
      WHERE id = ?`,
  ).run(
    contentJson,
    'Notion 과제 DB에서 동기화된 원본 속성입니다.',
    actorId,
    latest.id,
  );
}

function upsertAssignmentFromPage(
  db: Db,
  page: NotionPage,
  cfg: AssignmentDbCfg,
  actorId: number | null,
): AssignmentUpsertResult {
  const props = (page.properties ?? {}) as Record<string, unknown>;
  const sourceLabel = (cfg.label ?? cfg.id.slice(0, 8)).trim() || cfg.id.slice(0, 8);
  const flatProps = flattenProperties(props);

  const subject =
    readConfiguredText(props, cfg.subjectField, [
      '과목명',
      '과목',
      'subject',
      'Subject',
    ]) || '미분류';
  const title =
    readConfiguredText(props, cfg.titleField, [
      '수행평가명',
      '과제명',
      '보고서 주제',
      '주제',
      '제목',
      'title',
      'Title',
      'Name',
      '이름',
    ]) || readFirstTitle(props);

  if (!title) {
    return { status: 'skipped', files: [] };
  }

  const state = mapNotionStatusToState(
    readConfiguredText(props, cfg.statusField, [
      '진행 상황',
      '진행상황',
      '상태',
      'Status',
      'status',
    ]),
  );
  const parserId = resolveUserByName(
    db,
    readConfiguredText(props, cfg.parserField, [
      '작성자',
      '담당자',
      '작업자',
      'Parser',
      'parser',
    ]),
  );
  const qa1Id = resolveUserByName(
    db,
    readConfiguredText(props, cfg.qa1Field, [
      '1차 검토자',
      '1차QA',
      'QA1',
      'qa1',
    ]),
  );
  const qaFinalId = resolveUserByName(
    db,
    readConfiguredText(props, cfg.qaFinalField, [
      '2차 작성자',
      '최종 검토자',
      '최종QA',
      'QA Final',
      'qaFinal',
    ]),
  );
  const dueAt = readConfiguredDate(props, cfg.dueField, [
    '마감시한 (zap)',
    '마감시한',
    '마감일',
    'Due',
    'due',
  ]);

  const publisher =
    readConfiguredText(props, undefined, ['출판사', 'Publisher', 'publisher']) || null;
  const scope =
    readConfiguredText(props, undefined, ['수행범위', '범위', 'Scope', 'scope']) || null;
  const lengthReq =
    readConfiguredText(props, undefined, [
      '분량',
      '분량 요구',
      '분량요구',
      'Length',
      'length',
    ]) || null;
  const outline =
    readConfiguredText(props, undefined, ['개요', '구성', '목차', 'Outline', 'outline']) ||
    null;
  const rubric =
    readConfiguredText(props, undefined, [
      '평가기준',
      '평가 기준',
      '루브릭',
      'Rubric',
      'rubric',
    ]) || null;
  const teacherReq =
    readConfiguredText(props, undefined, [
      '교사요구',
      '교사 요구',
      '선생님 요청',
      'Teacher Requirements',
      'teacherRequirements',
    ]) || null;
  const studentReq =
    readConfiguredText(props, undefined, [
      '학생요구',
      '학생 요구',
      '학생 요청',
      'Student Requests',
      'studentRequests',
    ]) || null;

  const studentName = readConfiguredText(props, undefined, [
    'ㅤ',
    '이름',
    '학생명',
    '학생 이름',
    '학생이름',
    '성명',
    '학생',
    '학생명',
    '학생',
    '성명',
    'Name',
    '이름',
  ]);
  const studentId = studentName
    ? upsertStudentNaturalKey(db, {
        name: studentName,
        school:
          readConfiguredText(props, undefined, ['학교', '학교명', 'School']) || null,
        grade: readConfiguredText(props, undefined, ['학년', 'Grade']) || null,
        phone:
          readConfiguredText(props, undefined, [
            '학생 연락처',
            '연락처',
            '전화번호',
            'Phone',
          ]) || null,
        guardianPhone:
          readConfiguredText(props, undefined, [
            '학부모 연락처',
            '보호자 연락처',
            'Guardian Phone',
          ]) || null,
        sourceLabel,
        notionPageId: page.id,
        extraProps: flatProps,
      })
    : null;

  const existing = db
    .prepare(
      `SELECT id, student_id, student_code
         FROM assignments
        WHERE notion_page_id = ?
        LIMIT 1`,
    )
    .get(page.id) as
    | { id: number; student_id: number | null; student_code: string | null }
    | undefined;

  const resolvedStudentId = studentId ?? existing?.student_id ?? null;
  const resolvedStudentCode =
    readStudentCode(db, resolvedStudentId) ?? existing?.student_code ?? '-';
  const files = collectFiles(props);
  const parsingPayload = buildNotionParsingPayload({
    sourceLabel,
    page,
    flatProps,
    files,
    subject,
    title,
    scope,
    lengthReq,
    outline,
    rubric,
    teacherReq,
    studentReq,
  });
  const extraJson = JSON.stringify({
    source: sourceLabel,
    notionUrl: page.url ?? null,
    properties: flatProps,
    files,
  });

  if (existing) {
    db.prepare(
      `UPDATE assignments
          SET subject = ?,
              publisher = ?,
              student_id = ?,
              student_code = ?,
              title = ?,
              scope = ?,
              length_req = ?,
              outline = ?,
              rubric = ?,
              teacher_req = ?,
              student_req = ?,
              state = ?,
              risk = COALESCE(risk, 'medium'),
              parser_id = ?,
              qa1_id = ?,
              qa_final_id = ?,
              due_at = ?,
              notion_source = ?,
              notion_synced_at = datetime('now'),
              notion_extra = ?,
              deleted_at = NULL,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      subject,
      publisher,
      resolvedStudentId,
      resolvedStudentCode,
      title,
      scope,
      lengthReq,
      outline,
      rubric,
      teacherReq,
      studentReq,
      state,
      parserId,
      qa1Id,
      qaFinalId,
      dueAt,
      sourceLabel,
      extraJson,
      existing.id,
    );
    syncNotionParsingSnapshot(db, existing.id, parsingPayload, actorId);
    syncNotionAssignmentArchiveFiles(db, {
      assignmentId: existing.id,
      studentId: resolvedStudentId,
      files,
      actorId,
      reportTitle: title,
      subject,
      sourceLabel,
    });
    return {
      status: 'updated',
      assignmentId: existing.id,
      studentId: resolvedStudentId,
      files,
    };
  }

  const code = nextAssignmentCode(db, `A-N-${shortId(page.id)}`);
  const receivedAt = page.created_time || new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO assignments
         (code, subject, publisher, student_id, student_code,
          title, scope, length_req, outline, rubric,
          teacher_req, student_req, state, risk,
          parser_id, qa1_id, qa_final_id, due_at, received_at,
          notion_page_id, notion_source, notion_synced_at, notion_extra)
       VALUES (?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?, 'medium',
               ?, ?, ?, ?, ?,
               ?, ?, datetime('now'), ?)`,
    )
    .run(
      code,
      subject,
      publisher,
      resolvedStudentId,
      resolvedStudentCode,
      title,
      scope,
      lengthReq,
      outline,
      rubric,
      teacherReq,
      studentReq,
      state,
      parserId,
      qa1Id,
      qaFinalId,
      dueAt,
      receivedAt,
      page.id,
      sourceLabel,
      extraJson,
    );

  const assignmentId = Number(info.lastInsertRowid);
  syncNotionParsingSnapshot(db, assignmentId, parsingPayload, actorId);
  syncNotionAssignmentArchiveFiles(db, {
    assignmentId,
    studentId: resolvedStudentId,
    files,
    actorId,
    reportTitle: title,
    subject,
    sourceLabel,
  });
  return { status: 'inserted', assignmentId, studentId: resolvedStudentId, files };
}

// ---------------------------------------------------------------------------
// 과제 동기화 — Notion DB 페이지를 assignments 로 idempotent upsert.
// ---------------------------------------------------------------------------
export async function syncAssignments(
  db: Db,
  actorId: number | null | undefined,
  deps: AssignmentSyncDeps,
): Promise<AssignmentRunSummary & { runId: number }> {
  const { getNotionSettings, writeRun } = deps;
  const { token, assignmentDatabases } = getNotionSettings(db);
  const started = new Date().toISOString();
  if (!token) {
    const summary: AssignmentRunSummary = {
      kind: 'assignments',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: 'Notion 토큰이 설정되지 않았습니다.',
      triggeredBy: actorId ?? null,
    };
    const runId = writeRun(db, started, summary);
    return { ...summary, runId };
  }

  const dbs = assignmentDatabases.filter((cfg) => cfg.id?.trim());
  if (dbs.length === 0) {
    const summary: AssignmentRunSummary = {
      kind: 'assignments',
      ok: false,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      message: '동기화할 과제 Notion DB가 없습니다.',
      triggeredBy: actorId ?? null,
    };
    const runId = writeRun(db, started, summary);
    return { ...summary, runId };
  }

  const client = new NotionClient(token);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const messages: string[] = [];

  for (const cfg of dbs) {
    const label = cfg.label ?? cfg.id.slice(0, 8);
    try {
      const pages = await client.queryAllPages(cfg.id, 1000);
      db.transaction((list: NotionPage[]) => {
        for (const page of list) {
          try {
            const result = upsertAssignmentFromPage(
              db,
              page,
              cfg,
              actorId ?? null,
            );
            if (result.status === 'inserted') inserted += 1;
            else if (result.status === 'updated') updated += 1;
            else skipped += 1;
          } catch (pageErr) {
            errors += 1;
            const msg =
              pageErr instanceof Error ? pageErr.message : String(pageErr);
            messages.push(`[${label}] ${page.id}: ${msg}`);
          }
        }
      })(pages);
    } catch (err) {
      errors += 1;
      const msg = err instanceof Error ? err.message : String(err);
      messages.push(`[${label}] query failed: ${msg}`);
    }
  }

  const summary: AssignmentRunSummary = {
    kind: 'assignments',
    ok: errors === 0,
    inserted,
    updated,
    skipped,
    errors,
    message:
      messages.length > 0
        ? messages.slice(0, 5).join(' | ')
        : `과제 ${inserted + updated}건 반영 (신규 ${inserted}, 갱신 ${updated}, 건너뜀 ${skipped})`,
    triggeredBy: actorId ?? null,
  };
  const runId = writeRun(db, started, summary);
  return { ...summary, runId };
}

// ---------------------------------------------------------------------------
// 외부에서 단일 네임스페이스로 호출하기 위한 진입점 모음. ipc.ts 가
// `import { NotionSync } from './notion-sync'` 로 참조합니다.
// ---------------------------------------------------------------------------
