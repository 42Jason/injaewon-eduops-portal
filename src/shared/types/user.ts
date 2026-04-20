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
  | 'STAFF';

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
  };
}
