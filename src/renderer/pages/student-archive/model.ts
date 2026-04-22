// -----------------------------------------------------------------------------
// Types mirroring the shape returned by students:* IPC handlers.
// -----------------------------------------------------------------------------

export interface StudentListRow {
  id: number;
  student_code: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  school_no?: string | null;
  phone?: string | null;
  guardian?: string | null;
  guardian_phone?: string | null;
  grade_memo?: string | null;
  memo?: string | null;
  notion_page_id?: string | null;
  notion_source?: string | null;
  identity_key?: string | null;
  identity_label?: string | null;
  name_masked?: number | boolean | null;
  deleted_at?: string | null;
  created_at: string;
  assignment_count: number;
  topic_count: number;
  file_count: number;
}

export interface StudentGroupRow extends StudentListRow {
  group_key: string;
  student_ids: number[];
  student_codes: string[];
  grades: string[];
  rows: StudentListRow[];
  duplicate_count: number;
}

export interface StudentDetail {
  id: number;
  student_code: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  school_no?: string | null;
  phone?: string | null;
  guardian?: string | null;
  guardian_phone?: string | null;
  grade_memo?: string | null;
  memo?: string | null;
  monthly_fee?: number;
  billing_day?: number;
  billing_active?: number;
  notion_page_id?: string | null;
  notion_source?: string | null;
  notion_synced_at?: string | null;
  created_at: string;
  deleted_at?: string | null;
}

export interface GradeRow {
  id: number;
  student_id: number;
  grade_level: string;
  semester: string;
  subject: string;
  score?: string | null;
  raw_score?: number | null;
  memo?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CounselingLogRow {
  id: number;
  student_id: number;
  log_date: string;
  title: string;
  body?: string | null;
  category?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentRow {
  id: number;
  code: string;
  title: string;
  subject: string;
  publisher?: string | null;
  scope?: string | null;
  length_req?: string | null;
  state: string;
  risk: 'low' | 'medium' | 'high';
  due_at?: string | null;
  received_at?: string | null;
  completed_at?: string | null;
  parser_id?: number | null;
  qa1_id?: number | null;
  qa_final_id?: number | null;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  parsing_count: number;
}

export interface ParsingRow {
  id: number;
  assignment_id: number;
  version: number;
  ai_summary?: string | null;
  confidence?: number | null;
  parsed_at: string;
  parsed_by?: number | null;
  parser_name?: string | null;
  assignment_code: string;
  assignment_title: string;
  assignment_subject: string;
}

export interface ParsingDetail extends ParsingRow {
  content_json: string;
  student_id?: number | null;
  student_code?: string | null;
  assignment_publisher?: string | null;
  assignment_scope?: string | null;
  assignment_length_req?: string | null;
  assignment_due_at?: string | null;
}

export type TopicStatus = 'planned' | 'in_progress' | 'submitted' | 'graded' | 'archived' | 'cancelled';

export interface TopicRow {
  id: number;
  student_id: number;
  title: string;
  subject?: string | null;
  topic?: string | null;
  status: TopicStatus;
  assignment_id?: number | null;
  assignment_code?: string | null;
  due_at?: string | null;
  submitted_at?: string | null;
  score?: string | null;
  memo?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
}

export type ArchiveCategory = 'report' | 'draft' | 'reference' | 'feedback' | 'other';

export interface ArchiveFileRow {
  id: number;
  student_id: number;
  topic_id?: number | null;
  category: ArchiveCategory;
  original_name: string;
  stored_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  description?: string | null;
  uploaded_at: string;
  uploaded_by?: number | null;
  uploader_name?: string | null;
  topic_title?: string | null;
  source_assignment_id?: number | null;
  auto_generated?: number;
  source_assignment_code?: string | null;
  source_assignment_title?: string | null;
  source_assignment_state?: string | null;
}

// -----------------------------------------------------------------------------
// Display helpers
// -----------------------------------------------------------------------------

export const TOPIC_STATUS: Record<TopicStatus, { label: string; tone: string }> = {
  planned:     { label: '계획',   tone: 'bg-bg-soft text-fg-subtle border-border' },
  in_progress: { label: '진행중', tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  submitted:   { label: '제출',   tone: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  graded:      { label: '채점완료', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  archived:    { label: '보관',   tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  cancelled:   { label: '취소',   tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

export const CATEGORY_LABEL: Record<ArchiveCategory, string> = {
  report: '최종 보고서',
  draft: '초안',
  reference: '참고 자료',
  feedback: '피드백',
  other: '기타',
};

export const CATEGORY_TONE: Record<ArchiveCategory, string> = {
  report: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  draft: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  reference: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  feedback: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  other: 'bg-bg-soft text-fg-subtle border-border',
};

export function fmtFileSize(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtConfidence(c?: number | null): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '-';
  return `${Math.round(c * 100)}%`;
}

export function normalizeStudentKeyPart(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

export function studentGroupKey(row: StudentListRow): string {
  if (row.identity_key) return row.identity_key;
  const name = normalizeStudentKeyPart(row.name);
  const school = normalizeStudentKeyPart(row.school);
  const contact = normalizeStudentKeyPart(row.guardian_phone || row.phone);
  if (name && school) return `name:${name}|school:${school}`;
  if (name && contact) return `name:${name}|contact:${contact}`;
  return `id:${row.id}`;
}

export function uniqText(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function groupStudents(rows: StudentListRow[]): StudentGroupRow[] {
  const groups = new Map<string, StudentListRow[]>();
  for (const row of rows) {
    const key = studentGroupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return Array.from(groups.entries()).map(([groupKey, groupRows]) => {
    const primary = groupRows[0];
    const grades = uniqText(groupRows.map((r) => r.grade));
    return {
      ...primary,
      group_key: groupKey,
      student_ids: groupRows.map((r) => r.id),
      student_codes: uniqText(groupRows.map((r) => r.student_code)),
      grades,
      rows: groupRows,
      duplicate_count: groupRows.length,
      grade: grades[0] ?? primary.grade,
      assignment_count: groupRows.reduce((sum, r) => sum + (r.assignment_count ?? 0), 0),
      topic_count: groupRows.reduce((sum, r) => sum + (r.topic_count ?? 0), 0),
      file_count: groupRows.reduce((sum, r) => sum + (r.file_count ?? 0), 0),
    };
  });
}

export function matchesStudentGroup(group: StudentGroupRow, query: string): boolean {
  const q = normalizeStudentKeyPart(query);
  if (!q) return true;
  return group.rows.some((row) => {
    const hay = [
      row.name,
      row.student_code,
      row.grade,
      row.school,
      row.school_no,
      row.guardian,
      row.phone,
      row.guardian_phone,
    ].map(normalizeStudentKeyPart).join(' ');
    return hay.includes(q);
  });
}

export function studentIdsKey(studentIds: number[]): string {
  return studentIds.join(',');
}

export function uniqueById<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function sortIsoDesc<T>(rows: T[], pick: (row: T) => string | null | undefined): T[] {
  return [...rows].sort((a, b) => (pick(b) ?? '').localeCompare(pick(a) ?? ''));
}

export type JsonRecord = Record<string, unknown>;

export interface ParsingJsonFile {
  name: string;
  url: string;
  kind?: 'draft' | 'final' | 'attachment' | string;
  expires?: string;
}

export interface ParsingJsonDraft {
  subject: string;
  publisher: string;
  studentCode: string;
  studentPhone: string;
  guardianPhone: string;
  career: string;
  assignmentTitle: string;
  assignmentScope: string;
  lengthRequirement: string;
  outline: string;
  rubric: string;
  teacherRequirements: string;
  studentRequests: string;
  sourceFile: string;
  sourceRow: string;
  files: ParsingJsonFile[];
}

export function parseJsonRecord(json?: string | null): JsonRecord | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

export function jsonText(record: JsonRecord | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value =
      record[key] ??
      (record.properties && typeof record.properties === 'object'
        ? (record.properties as JsonRecord)[key]
        : undefined);
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
        .filter(Boolean)
        .join('\n');
      if (joined) return joined;
    }
  }
  return '';
}

export function jsonFiles(record: JsonRecord | null): ParsingJsonFile[] {
  const value = record?.files;
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ParsingJsonFile | null => {
      if (!item || typeof item !== 'object') return null;
      const file = item as JsonRecord;
      const name = typeof file.name === 'string' ? file.name.trim() : '';
      const url = typeof file.url === 'string' ? file.url.trim() : '';
      if (!name || !url) return null;
      return {
        name,
        url,
        kind: typeof file.kind === 'string' ? file.kind : undefined,
        expires: typeof file.expires === 'string' ? file.expires : undefined,
      };
    })
    .filter((file): file is ParsingJsonFile => Boolean(file));
}

export function buildParsingJsonDraft(detail: ParsingDetail | null | undefined): ParsingJsonDraft {
  const record = parseJsonRecord(detail?.content_json);
  return {
    subject: jsonText(record, ['subject', '과목']) || detail?.assignment_subject || '',
    publisher: jsonText(record, ['publisher', '출판사']) || detail?.assignment_publisher || '',
    studentCode:
      jsonText(record, ['studentCode', 'student_code', '학생코드']) || detail?.student_code || '',
    studentPhone: jsonText(record, [
      'studentPhone',
      'student_phone',
      '학생 연락처',
      '학생연락처',
      '연락처',
      '전화번호',
      'Phone',
      'phone',
    ]),
    guardianPhone: jsonText(record, [
      'guardianPhone',
      'guardian_phone',
      '학부모 연락처',
      '보호자 연락처',
      '학부모 전화번호',
      '보호자 전화번호',
      'Guardian Phone',
    ]),
    career: jsonText(record, ['career', 'Career', '진로', '희망 진로', '희망전공', '전공']),
    assignmentTitle:
      jsonText(record, ['assignmentTitle', 'title', '수행평가명', '보고서 주제']) ||
      detail?.assignment_title ||
      '',
    assignmentScope: jsonText(record, ['assignmentScope', 'scope', '범위']) || detail?.assignment_scope || '',
    lengthRequirement:
      jsonText(record, ['lengthRequirement', 'length_req', '분량']) ||
      detail?.assignment_length_req ||
      '',
    outline: jsonText(record, ['outline', '개요']),
    rubric: jsonText(record, ['rubric', '평가기준']),
    teacherRequirements: jsonText(record, ['teacherRequirements', '교사요구사항']),
    studentRequests: jsonText(record, ['studentRequests', '학생요청']),
    sourceFile: jsonText(record, ['sourceFile', 'filename', '파일명']),
    sourceRow: jsonText(record, ['sourceRow', 'rowNumber', '행번호']),
    files: jsonFiles(record),
  };
}

export function labeledLines(items: Array<[string, string]>): string {
  return items
    .map(([label, value]) => (value ? `${label}: ${value}` : ''))
    .filter(Boolean)
    .join('\n');
}

export function appendParsingMemo(
  existing: string | null | undefined,
  detail: ParsingDetail,
  draft: ParsingJsonDraft,
): string {
  const current = existing?.trim() ?? '';
  const marker = `[파싱 결과 #${detail.id}]`;
  if (current.includes(marker)) return current;
  const note = [
    marker,
    labeledLines([
      ['학생코드', draft.studentCode],
      ['학생', draft.studentPhone],
      ['학부모', draft.guardianPhone],
      ['진로', draft.career],
      ['과목', draft.subject],
      ['출판사', draft.publisher],
      ['수행평가명', draft.assignmentTitle],
      ['범위', draft.assignmentScope],
      ['분량', draft.lengthRequirement],
      ['원본 파일', draft.sourceFile],
    ]),
  ]
    .filter(Boolean)
    .join('\n');
  return [current, note].filter(Boolean).join('\n\n');
}

export function buildParsingTopicBody(draft: ParsingJsonDraft): string {
  return labeledLines([
    ['학생', draft.studentPhone],
    ['학부모', draft.guardianPhone],
    ['진로', draft.career],
    ['범위', draft.assignmentScope],
    ['분량', draft.lengthRequirement],
    ['개요', draft.outline],
    ['평가기준', draft.rubric],
    ['교사 요구사항', draft.teacherRequirements],
    ['학생 요청', draft.studentRequests],
  ]);
}

export function archiveCategoryForParsingFile(file: ParsingJsonFile): ArchiveCategory {
  if (file.kind === 'final') return 'report';
  if (file.kind === 'draft') return 'draft';
  return 'reference';
}

export function isExternalUrl(value?: string | null): boolean {
  return /^https?:\/\//i.test(value ?? '');
}

// -----------------------------------------------------------------------------
// Main page
// -----------------------------------------------------------------------------

export type Tab = 'overview' | 'grades' | 'counseling' | 'parsing' | 'topics' | 'files';
