/**
 * User roles — see spec §3. Keep this enum in sync with the DB check-constraint.
 */
export type Role =
  | 'CEO'
  | 'CTO'
  | 'OPS_MANAGER'
  | 'HR_ADMIN'
  | 'PARSER'
  | 'QA1'
  | 'QA_FINAL'
  | 'CS'
  | 'STAFF'
  | 'TA';

export const ROLE_LABELS: Record<Role, string> = {
  CEO: '대표',
  CTO: 'CTO',
  OPS_MANAGER: '운영 매니저',
  HR_ADMIN: '행정/인사',
  PARSER: '파싱팀',
  QA1: '1차 QA',
  QA_FINAL: '최종 QA',
  CS: 'CS',
  STAFF: '일반 직원',
  TA: '조교',
};

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  departmentId: number | null;
  departmentName?: string;
  title?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  active: boolean;
  createdAt: string;
}

export interface SessionUser extends User {
  /** Loose bag of flags derived from role — populated by the session store. */
  perms: {
    canReviewQA1: boolean;
    canReviewQAFinal: boolean;
    canParseAssignments: boolean;
    canManagePeople: boolean;
    canApprove: boolean;
    isLeadership: boolean;
    /** TA가 업로드한 파싱 엑셀을 내려받고 소비 처리할 수 있는가? (정규직 한정) */
    canReviewParsedExcel: boolean;
    /** 화면 접근을 파싱 관련 기능으로만 제한해야 하는가? (조교 전용) */
    isParsingAssistantOnly: boolean;
  };
}
