import type { CsTicket, ManualPage, Notice } from '../types/knowledge';

export const MOCK_NOTICES: Notice[] = [
  {
    id: 1,
    title: '[전사] 5월 창립기념일 휴무 안내',
    body: '5월 8일(금)은 창립기념일로 전사 휴무입니다. 긴급 CS 대응 당직은 별도 공지 예정입니다.',
    authorId: 4,
    authorName: '최인사',
    audience: 'ALL',
    pinned: true,
    publishedAt: '2026-04-18T10:00:00+09:00',
    archivedAt: null,
  },
  {
    id: 2,
    title: '[파싱팀] Excel 템플릿 v3 배포 — 반드시 사용',
    body: '기존 v2 템플릿은 4/25 이후 자동 반려됩니다. v3 템플릿은 자료실 > 템플릿 폴더에 업로드되어 있습니다.',
    authorId: 2,
    authorName: '이기술',
    audience: 'PARSER',
    pinned: false,
    publishedAt: '2026-04-17T14:30:00+09:00',
    archivedAt: null,
  },
  {
    id: 3,
    title: '[QA] 최종QA 체크리스트 업데이트 (v1.4)',
    body: '평가기준 가중치 반영 항목이 추가되었습니다. 상세 내용은 매뉴얼 > QA > 최종 QA 체크리스트 문서를 참고해주세요.',
    authorId: 3,
    authorName: '박운영',
    audience: 'QA_FINAL',
    pinned: false,
    publishedAt: '2026-04-16T09:00:00+09:00',
    archivedAt: null,
  },
  {
    id: 4,
    title: '[CS] 카카오톡 채널 응대 시간 변경',
    body: '응대 시간이 09:00~19:00 로 조정됩니다 (4/21 부터).',
    authorId: 3,
    authorName: '박운영',
    audience: 'CS',
    pinned: false,
    publishedAt: '2026-04-14T17:00:00+09:00',
    archivedAt: null,
  },
];

export const MOCK_MANUAL_PAGES: ManualPage[] = [
  { id: 1, slug: 'parsing-sop-missing-docs', title: '파싱 SOP — 안내문 누락 대응',   body: '# 파싱 SOP\n누락 자료 발견 시 절차...',     category: '파싱',   parentId: null, authorId: 2, version: 3, updatedAt: '2026-04-17', createdAt: '2025-09-01' },
  { id: 2, slug: 'qa1-checklist-v13',         title: '1차 QA 체크리스트 (v1.3)',       body: '# 1차 QA 체크리스트\n1. 과목 일치...',   category: 'QA',    parentId: null, authorId: 3, version: 13, updatedAt: '2026-04-15', createdAt: '2025-05-20' },
  { id: 3, slug: 'qa-final-checklist-v14',    title: '최종 QA 체크리스트 (v1.4)',      body: '# 최종 QA\n가중치 반영 신설...',          category: 'QA',    parentId: null, authorId: 3, version: 14, updatedAt: '2026-04-16', createdAt: '2025-05-20' },
  { id: 4, slug: 'leave-policy',              title: '휴가 신청 절차',                   body: '# 휴가 신청\n신청 → 결재선...',         category: 'HR',    parentId: null, authorId: 4, version: 2,  updatedAt: '2026-04-10', createdAt: '2025-02-10' },
  { id: 5, slug: 'cs-ticket-triage',          title: 'CS 티켓 분류 기준',                body: '# CS 티켓 분류\nurgent / high ...',       category: 'CS',    parentId: null, authorId: 9, version: 2,  updatedAt: '2026-04-09', createdAt: '2025-05-01' },
  { id: 6, slug: 'excel-template-v3',         title: 'Excel 템플릿 v3 사용 가이드',      body: '# Excel v3\n시트명 고정: 예시 포함 ...', category: '파싱',   parentId: null, authorId: 2, version: 1,  updatedAt: '2026-04-17', createdAt: '2026-04-17' },
  { id: 7, slug: 'assignment-state-machine',  title: '과제 16단계 상태머신',             body: '# 상태머신\n신규접수 → 자료누락 → ...', category: '운영',  parentId: null, authorId: 3, version: 4,  updatedAt: '2026-04-05', createdAt: '2025-03-10' },
  { id: 8, slug: 'onboarding-new-hire',       title: '신입 온보딩 체크리스트',            body: '# 온보딩\n1일차 / 1주차 / 1개월 ...',   category: 'HR',    parentId: null, authorId: 4, version: 3,  updatedAt: '2026-03-28', createdAt: '2025-01-20' },
];

export const MOCK_CS_TICKETS: CsTicket[] = [
  { id: 1,  code: 'CS-0101', channel: 'phone',  studentCode: 'S-0012', inquirer: '학부모A', subject: '제출 기한 연기 문의',       body: '가족 사유로 3일 연기 요청',      priority: 'high',   status: 'open',        assigneeId: 9, relatedAssignmentId: 241, openedAt: '2026-04-19T09:15:00' },
  { id: 2,  code: 'CS-0102', channel: 'kakao',  studentCode: 'S-0017', inquirer: '학생',    subject: '파싱 결과 중 범위 오류 제보', body: '2단원이 아닌 4단원이라고 함', priority: 'urgent', status: 'in_progress', assigneeId: 9, relatedAssignmentId: 251, openedAt: '2026-04-19T11:02:00' },
  { id: 3,  code: 'CS-0103', channel: 'email',  studentCode: 'S-0023', inquirer: '학부모B', subject: '포트폴리오 샘플 요청',        body: '참고용 샘플 3개 요청',          priority: 'normal', status: 'waiting',     assigneeId: 9, relatedAssignmentId: 245, openedAt: '2026-04-18T15:45:00' },
  { id: 4,  code: 'CS-0104', channel: 'phone',  studentCode: 'S-0088', inquirer: '학부모C', subject: '반려 사유 상세 설명 요청',    body: '1차 QA 반려 사유 요청',        priority: 'high',   status: 'resolved',    assigneeId: 9, relatedAssignmentId: 267, openedAt: '2026-04-17T10:30:00', resolvedAt: '2026-04-17T14:10:00' },
];
