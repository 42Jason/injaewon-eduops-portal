import * as XLSX from 'xlsx';

/**
 * Spec §9 — "예시 포함" 시트 구조:
 *   - 7행이 헤더 (열 순서는 아래 FIELD_ORDER 와 동일)
 *   - 8~17행이 실제 데이터 (최대 10 건)
 *
 * 열 수가 맞지 않더라도 헤더 텍스트 매칭으로 한번 더 보정한다.
 */

export const FIELD_ORDER = [
  'subject',             // 과목
  'publisher',           // 출판사
  'studentCode',         // 학생
  'assignmentTitle',     // 수행평가명
  'assignmentScope',     // 수행범위
  'lengthRequirement',   // 분량
  'outline',             // 개요
  'rubric',              // 평가기준
  'teacherRequirements', // 교사요구
  'studentRequests',     // 학생요구
] as const;

export type FieldKey = (typeof FIELD_ORDER)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  subject: '과목',
  publisher: '출판사',
  studentCode: '학생',
  assignmentTitle: '수행평가명',
  assignmentScope: '수행범위',
  lengthRequirement: '분량',
  outline: '개요',
  rubric: '평가기준',
  teacherRequirements: '교사요구',
  studentRequests: '학생요구',
};

/** Korean header keywords used to detect which column maps to which field. */
const HEADER_HINTS: Record<FieldKey, string[]> = {
  subject:             ['과목'],
  publisher:           ['출판사'],
  studentCode:         ['학생', '학생코드'],
  assignmentTitle:     ['수행평가명', '과제명', '수행평가'],
  assignmentScope:     ['수행범위', '범위'],
  lengthRequirement:   ['분량'],
  outline:             ['개요'],
  rubric:              ['평가기준', '채점기준'],
  teacherRequirements: ['교사요구', '교사 요구', '교사 요청', '교사요청'],
  studentRequests:     ['학생요구', '학생 요구', '학생 요청', '학생요청'],
};

export interface ParsedRow {
  rowNumber: number;            // 1-based Excel row
  subject: string;
  publisher: string;
  studentCode: string;
  assignmentTitle: string;
  assignmentScope: string;
  lengthRequirement: string;
  outline: string;
  rubric: string;
  teacherRequirements: string;
  studentRequests: string;
  valid: boolean;               // 필수값(과목/학생코드/수행평가명) 유무
  errors: string[];
}

export interface PreviewResult {
  sheetName: string;
  filename: string;
  rows: ParsedRow[];
  headerRow: number;
  warnings: string[];
  headerMap: Record<FieldKey, number | null>;  // field → zero-based col index
  availableSheets: string[];
}

/** Entry point — parse a raw Excel buffer into preview rows. */
export function parseInstructionExcel(buffer: Buffer | Uint8Array, filename: string): PreviewResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const warnings: string[] = [];

  // Prefer the canonical "예시 포함" sheet, else first non-empty sheet
  const preferred = '예시 포함';
  let sheetName = wb.SheetNames.find((n) => n.trim() === preferred) ?? '';
  if (!sheetName) {
    const fallback = wb.SheetNames.find((n) => n.includes('예시')) ?? wb.SheetNames[0];
    sheetName = fallback ?? '';
    if (sheetName) warnings.push(`시트 "${preferred}"를 찾지 못해 "${sheetName}" 를 사용합니다.`);
  }
  if (!sheetName) {
    return {
      sheetName: '',
      filename,
      rows: [],
      headerRow: 7,
      warnings: ['엑셀 파일에 시트가 없습니다.'],
      headerMap: blankHeaderMap(),
      availableSheets: wb.SheetNames,
    };
  }

  const sheet = wb.Sheets[sheetName];
  // defval: '' keeps empty cells as empty strings (not undefined) so row arrays are dense.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  }) as unknown[][];

  // Locate header row — prefer exact row 7 (index 6), else search first 12 rows for the hints.
  let headerRowIdx = 6;
  if (!rowLooksLikeHeader(matrix[headerRowIdx])) {
    const found = findHeaderRow(matrix, 12);
    if (found >= 0) {
      headerRowIdx = found;
      if (headerRowIdx !== 6)
        warnings.push(`헤더가 7행이 아닌 ${headerRowIdx + 1}행에서 감지되었습니다.`);
    } else {
      warnings.push('스펙상의 헤더 행(7행)을 찾지 못해 열 순서 기본값으로 파싱합니다.');
    }
  }
  const headerRow = (matrix[headerRowIdx] ?? []) as unknown[];
  const headerMap = buildHeaderMap(headerRow);

  // Data rows — 8 to 17 (indices 7..16). Still keep rows with at least one non-empty cell.
  const rows: ParsedRow[] = [];
  for (let i = headerRowIdx + 1; i < Math.min(headerRowIdx + 11, matrix.length); i++) {
    const r = (matrix[i] ?? []) as unknown[];
    if (r.every((c) => String(c ?? '').trim() === '')) continue;
    rows.push(rowToParsed(r, headerMap, i + 1));
  }

  if (rows.length === 0) warnings.push('데이터 행(8~17행)에 내용이 없습니다.');

  return {
    sheetName,
    filename,
    rows,
    headerRow: headerRowIdx + 1,
    warnings,
    headerMap,
    availableSheets: wb.SheetNames,
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */

function blankHeaderMap(): Record<FieldKey, number | null> {
  return Object.fromEntries(FIELD_ORDER.map((k) => [k, null])) as Record<FieldKey, number | null>;
}

function normalize(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, '').toLowerCase();
}

function rowLooksLikeHeader(row: unknown[] | undefined): boolean {
  if (!row) return false;
  const cells = row.map(normalize);
  return HEADER_HINTS.subject.some((h) => cells.includes(normalize(h)))
    && HEADER_HINTS.assignmentTitle.some((h) => cells.some((c) => c.includes(normalize(h))));
}

function findHeaderRow(matrix: unknown[][], scanLimit: number): number {
  for (let i = 0; i < Math.min(scanLimit, matrix.length); i++) {
    if (rowLooksLikeHeader(matrix[i])) return i;
  }
  return -1;
}

function buildHeaderMap(headerRow: unknown[]): Record<FieldKey, number | null> {
  const normalized = headerRow.map(normalize);
  const map = blankHeaderMap();
  for (const field of FIELD_ORDER) {
    const hints = HEADER_HINTS[field].map(normalize);
    const idx = normalized.findIndex((cell) => hints.some((h) => cell.includes(h)));
    map[field] = idx >= 0 ? idx : null;
  }
  // Fallback: if we couldn't detect ANY header columns (e.g. sheet missing headers),
  // assume the column order matches FIELD_ORDER.
  const mapped = Object.values(map).filter((v) => v !== null).length;
  if (mapped === 0) {
    FIELD_ORDER.forEach((f, i) => (map[f] = i));
  }
  return map;
}

function rowToParsed(
  row: unknown[],
  map: Record<FieldKey, number | null>,
  rowNumber: number,
): ParsedRow {
  const read = (f: FieldKey) => {
    const idx = map[f];
    if (idx == null) return '';
    const raw = row[idx];
    return String(raw ?? '').trim();
  };
  const p: ParsedRow = {
    rowNumber,
    subject:             read('subject'),
    publisher:           read('publisher'),
    studentCode:         read('studentCode'),
    assignmentTitle:     read('assignmentTitle'),
    assignmentScope:     read('assignmentScope'),
    lengthRequirement:   read('lengthRequirement'),
    outline:             read('outline'),
    rubric:              read('rubric'),
    teacherRequirements: read('teacherRequirements'),
    studentRequests:     read('studentRequests'),
    valid: true,
    errors: [],
  };
  if (!p.subject)         p.errors.push('과목 누락');
  if (!p.studentCode)     p.errors.push('학생코드 누락');
  if (!p.assignmentTitle) p.errors.push('수행평가명 누락');
  p.valid = p.errors.length === 0;
  return p;
}
