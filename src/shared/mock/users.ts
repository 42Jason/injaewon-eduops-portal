import type { User } from '../types/user';

export const MOCK_DEPARTMENTS = [
  { id: 1, name: '경영' },
  { id: 2, name: '운영' },
  { id: 3, name: '행정/인사' },
  { id: 4, name: '파싱팀' },
  { id: 5, name: 'QA' },
  { id: 6, name: 'CS' },
];

export const MOCK_USERS: User[] = [
  { id: 1,  email: 'ceo@eduops.kr',      name: '김대표', role: 'CEO',         departmentId: 1, departmentName: '경영',      title: '대표이사',   active: true, createdAt: '2024-01-01' },
  { id: 2,  email: 'cto@eduops.kr',      name: '이기술', role: 'CTO',         departmentId: 1, departmentName: '경영',      title: 'CTO',        active: true, createdAt: '2024-01-01' },
  { id: 3,  email: 'ops@eduops.kr',      name: '박운영', role: 'OPS_MANAGER', departmentId: 2, departmentName: '운영',      title: '운영매니저', active: true, createdAt: '2024-02-15' },
  { id: 4,  email: 'hr@eduops.kr',       name: '최인사', role: 'HR_ADMIN',    departmentId: 3, departmentName: '행정/인사', title: '인사담당',   active: true, createdAt: '2024-03-01' },
  { id: 5,  email: 'parser1@eduops.kr',  name: '정파싱', role: 'PARSER',      departmentId: 4, departmentName: '파싱팀',    title: '파싱팀장',   active: true, createdAt: '2024-03-10' },
  { id: 6,  email: 'parser2@eduops.kr',  name: '오미연', role: 'PARSER',      departmentId: 4, departmentName: '파싱팀',    title: '파싱원',     active: true, createdAt: '2024-06-01' },
  { id: 7,  email: 'qa1@eduops.kr',      name: '강QA1',  role: 'QA1',         departmentId: 5, departmentName: 'QA',        title: '1차 QA',     active: true, createdAt: '2024-04-20' },
  { id: 8,  email: 'qafinal@eduops.kr',  name: '윤최종', role: 'QA_FINAL',    departmentId: 5, departmentName: 'QA',        title: '최종 QA',    active: true, createdAt: '2024-04-20' },
  { id: 9,  email: 'cs@eduops.kr',       name: '장CS',   role: 'CS',          departmentId: 6, departmentName: 'CS',        title: 'CS 매니저',  active: true, createdAt: '2024-05-05' },
  { id: 10, email: 'staff@eduops.kr',    name: '한직원', role: 'STAFF',       departmentId: 2, departmentName: '운영',      title: '주임',       active: true, createdAt: '2025-01-10' },
];
