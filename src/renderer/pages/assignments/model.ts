import type { AssignmentState, Risk } from '@shared/types/assignment';

/** The shape we actually render — union of DB row and mock. */
export interface AssignmentRow {
  id: number;
  code: string;
  subject: string;
  publisher?: string | null;
  student_code?: string;
  studentCode?: string;
  title?: string;
  assignmentTitle?: string;
  scope?: string | null;
  assignmentScope?: string | null;
  state: AssignmentState;
  risk: Risk;
  parser_id?: number | null;
  qa1_id?: number | null;
  qa_final_id?: number | null;
  parserId?: number | null;
  qa1Id?: number | null;
  qaFinalId?: number | null;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  due_at?: string | null;
  dueAt?: string | null;
  received_at?: string;
  receivedAt?: string;
  completed_at?: string | null;
  completedAt?: string | null;
  rubric?: string | null;
  outline?: string | null;
  teacher_requirements?: string | null;
  teacherRequirements?: string | null;
  student_requests?: string | null;
  studentRequests?: string | null;
  length_requirement?: string | null;
  lengthRequirement?: string | null;
}

export interface ParsingRow {
  id?: number;
  assignment_id?: number;
  version?: number;
  content_json?: string;
  ai_summary?: string | null;
  confidence?: number | null;
  parsed_by?: number | null;
  parsed_at?: string;
}

export interface QaReviewRow {
  id: number;
  stage: 'QA1' | 'QA_FINAL';
  result: 'approved' | 'rejected' | 'revision_requested';
  comment?: string | null;
  reviewed_at: string;
  reviewer_name?: string | null;
  reviewer_role?: string | null;
}

/** Read a field regardless of whether it came from snake-case DB row or camel mock. */
export function pick<T>(row: AssignmentRow, a: keyof AssignmentRow, b: keyof AssignmentRow): T | undefined {
  return (row[a] ?? row[b]) as T | undefined;
}

export function rowTitle(r: AssignmentRow): string {
  return (pick<string>(r, 'assignmentTitle', 'title') ?? '-') as string;
}
export function rowStudent(r: AssignmentRow): string {
  return (pick<string>(r, 'studentCode', 'student_code') ?? '-') as string;
}
export function rowScope(r: AssignmentRow): string | null {
  return (pick<string>(r, 'assignmentScope', 'scope') ?? null) as string | null;
}
export function rowDue(r: AssignmentRow): string | null {
  return (pick<string>(r, 'dueAt', 'due_at') ?? null) as string | null;
}
export function rowReceived(r: AssignmentRow): string | undefined {
  return pick<string>(r, 'receivedAt', 'received_at');
}
export function rowCompleted(r: AssignmentRow): string | null {
  return (pick<string>(r, 'completedAt', 'completed_at') ?? null) as string | null;
}
export function rowParserName(r: AssignmentRow): string | null {
  return (r.parser_name ?? null);
}
export function rowQa1Name(r: AssignmentRow): string | null {
  return (r.qa1_name ?? null);
}
export function rowQaFinalName(r: AssignmentRow): string | null {
  return (r.qa_final_name ?? null);
}
export function rowRubric(r: AssignmentRow): string | null {
  return (r.rubric ?? null);
}

export const STATE_GROUPS: Array<{ label: string; states: AssignmentState[] }> = [
  { label: '파싱',      states: ['파싱대기', '파싱진행중', '파싱완료', '파싱확인필요'] },
  { label: '1차 QA',    states: ['1차QA대기', '1차QA진행중', '1차QA반려'] },
  { label: '최종 QA',   states: ['최종QA대기', '최종QA진행중', '최종QA반려'] },
  { label: '완료/보류', states: ['승인완료', '수정요청', '완료', '보류'] },
];
