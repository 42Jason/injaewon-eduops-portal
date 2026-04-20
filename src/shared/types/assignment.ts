/**
 * 과제 16단계 상태머신 (spec §6 상태 참조)
 */
export type AssignmentState =
  | '신규접수'
  | '자료누락'
  | '파싱대기'
  | '파싱진행중'
  | '파싱완료'
  | '파싱확인필요'
  | '1차QA대기'
  | '1차QA진행중'
  | '1차QA반려'
  | '최종QA대기'
  | '최종QA진행중'
  | '최종QA반려'
  | '승인완료'
  | '수정요청'
  | '완료'
  | '보류';

export const ASSIGNMENT_STATES: AssignmentState[] = [
  '신규접수',
  '자료누락',
  '파싱대기',
  '파싱진행중',
  '파싱완료',
  '파싱확인필요',
  '1차QA대기',
  '1차QA진행중',
  '1차QA반려',
  '최종QA대기',
  '최종QA진행중',
  '최종QA반려',
  '승인완료',
  '수정요청',
  '완료',
  '보류',
];

export type Risk = 'low' | 'medium' | 'high';

/**
 * Excel 입력 원본 필드 (spec §9, 시트 '예시 포함' 의 10 개 필드)
 */
export interface AssignmentInputFields {
  subject: string;              // 과목
  publisher?: string;           // 출판사
  studentCode: string;          // 학생 코드
  assignmentTitle: string;      // 수행평가명
  assignmentScope?: string;     // 수행범위
  lengthRequirement?: string;   // 분량
  outline?: string;             // 개요
  rubric?: string;              // 평가기준
  teacherRequirements?: string; // 교사요구
  studentRequests?: string;     // 학생요구
}

export interface Assignment extends AssignmentInputFields {
  id: number;
  code: string;
  state: AssignmentState;
  risk: Risk;
  parserId: number | null;
  qa1Id: number | null;
  qaFinalId: number | null;
  dueAt: string | null;
  receivedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParsingResult {
  id: number;
  assignmentId: number;
  version: number;
  content: unknown;
  aiSummary?: string | null;
  confidence?: number | null;
  parsedBy?: number | null;
  parsedAt: string;
}

export interface QaReview {
  id: number;
  assignmentId: number;
  stage: 'QA1' | 'QA_FINAL';
  reviewerId: number;
  result: 'approved' | 'rejected' | 'revision_requested';
  comment?: string | null;
  checklist?: Record<string, { checked: boolean; note?: string }>;
  reviewedAt: string;
}
