import type { Role } from '@shared/types/user';

export const ROLE_GROUPS = {
  all: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
    'TA',
  ],
  executive: ['CEO', 'CTO'],
  regularStaff: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  opsAdmin: ['CEO', 'CTO', 'OPS_MANAGER'],
  hrAdmin: ['CEO', 'CTO', 'HR_ADMIN'],
  knowledgeEditor: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  assignmentReader: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  studentDataReader: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  financeReader: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  subscriptionCardAdmin: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  auditReader: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  parser: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  parsingUploader: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
    'TA',
  ],
  parsingConsumer: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  qa1: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
  qaFinal: [
    'CEO',
    'CTO',
    'OPS_MANAGER',
    'HR_ADMIN',
    'PARSER',
    'QA1',
    'QA_FINAL',
    'CS',
    'STAFF',
  ],
} as const satisfies Record<string, readonly Role[]>;

export function hasRole(role: Role | null | undefined, allowedRoles?: readonly Role[]) {
  if (!allowedRoles) return true;
  return !!role && allowedRoles.includes(role);
}

export function rolesForPath(pathname: string): readonly Role[] | undefined {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (path === '/my-work') return ROLE_GROUPS.assignmentReader;
  if (path === '/assignments') return ROLE_GROUPS.assignmentReader;
  if (path === '/instruction-parser') return ROLE_GROUPS.parsingUploader;
  if (path === '/parsing/outputs') return ROLE_GROUPS.parsingConsumer;
  if (path === '/operations-board') return ROLE_GROUPS.assignmentReader;
  if (path === '/qa/first') return ROLE_GROUPS.qa1;
  if (path === '/qa/final') return ROLE_GROUPS.qaFinal;
  if (path === '/cs') return ROLE_GROUPS.assignmentReader;
  if (path === '/employees') return ROLE_GROUPS.hrAdmin;
  if (path === '/admin/tuition') return ROLE_GROUPS.financeReader;
  if (path === '/admin/payroll') return ROLE_GROUPS.hrAdmin;
  if (path === '/admin/subscriptions') return ROLE_GROUPS.subscriptionCardAdmin;
  if (path === '/admin/cards') return ROLE_GROUPS.subscriptionCardAdmin;
  if (path === '/students/archive') return ROLE_GROUPS.studentDataReader;
  if (path === '/reports') return ROLE_GROUPS.regularStaff;
  if (path === '/automation') return ROLE_GROUPS.executive;
  if (path === '/settings/notion') return ROLE_GROUPS.knowledgeEditor;
  if (path === '/trash') return ROLE_GROUPS.opsAdmin;
  if (path === '/release') return ROLE_GROUPS.executive;
  return undefined;
}
