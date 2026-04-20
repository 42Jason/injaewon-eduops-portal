import type { Assignment, AssignmentState, Risk } from '../types/assignment';

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

function pad(n: number, w = 4) {
  return String(n).padStart(w, '0');
}

interface Row {
  id: number;
  subject: string;
  publisher?: string;
  studentCode: string;
  title: string;
  scope?: string;
  outline?: string;
  rubric?: string;
  state: AssignmentState;
  risk: Risk;
  parserId?: number | null;
  qa1Id?: number | null;
  qaFinalId?: number | null;
  dueOffset: number;  // days from today
}

const ROWS: Row[] = [
  { id: 241, subject: '물리',   publisher: '비상교육', studentCode: 'S-0012', title: '중3 물리 수행평가 — 관성의 법칙',     scope: '1단원 전체', outline: '관성의 법칙 실험 보고서', rubric: '실험 설계 30 / 분석 40 / 결론 30', state: '1차QA대기',   risk: 'high',   parserId: 5, qa1Id: 7,  qaFinalId: 8, dueOffset: 0 },
  { id: 245, subject: '국어',   publisher: '천재교육', studentCode: 'S-0023', title: '고1 국어 — 독서 포트폴리오',           scope: '읽기 2단원',  outline: '3권 독후감 + 비평',     rubric: '내용 50 / 구성 30 / 표현 20', state: '파싱진행중',    risk: 'medium', parserId: 5, qa1Id: null, qaFinalId: null, dueOffset: 1 },
  { id: 251, subject: '영어',   publisher: 'YBM',      studentCode: 'S-0017', title: '중2 영어 — 자기소개 에세이',            scope: '4단원',       outline: '300단어 에세이',          rubric: '내용 40 / 문법 30 / 어휘 30', state: '최종QA진행중',  risk: 'low',    parserId: 6, qa1Id: 7,  qaFinalId: 8, dueOffset: 1 },
  { id: 260, subject: '수학',   publisher: '금성출판사', studentCode: 'S-0031', title: '고2 수학 — 심화 탐구 보고서',            scope: '미적분 3단원', outline: '실생활 활용 사례',         rubric: '수학적 정확성 60 / 표현 40', state: '파싱완료',       risk: 'low',    parserId: 6, qa1Id: null, qaFinalId: null, dueOffset: 2 },
  { id: 262, subject: '사회',   publisher: '지학사',    studentCode: 'S-0008', title: '중1 사회 — 우리 지역 조사 보고서',        scope: '3단원',       outline: '현장 조사 + 인터뷰',      rubric: '조사 40 / 분석 30 / 결론 30', state: '자료누락',       risk: 'medium', parserId: null, qa1Id: null, qaFinalId: null, dueOffset: 5 },
  { id: 263, subject: '과학',   publisher: '미래엔',    studentCode: 'S-0044', title: '중3 과학 — 생태계 관찰',                   scope: '5단원',       outline: '2주간 관찰 기록',          rubric: '관찰력 40 / 분석 40 / 표현 20', state: '신규접수',       risk: 'low',    parserId: null, qa1Id: null, qaFinalId: null, dueOffset: 7 },
  { id: 264, subject: '한국사', publisher: '비상교육', studentCode: 'S-0055', title: '고1 한국사 — 근대화 인물 탐구',           scope: '4단원',       outline: '인물 1명 선정 + 평가',     rubric: '자료조사 40 / 평가 40 / 표현 20', state: '파싱대기',       risk: 'low',    parserId: null, qa1Id: null, qaFinalId: null, dueOffset: 3 },
  { id: 265, subject: '영어',   publisher: '능률',      studentCode: 'S-0019', title: '중1 영어 — 자기소개 UCC 스크립트',        scope: '2단원',       outline: '2분 분량 스크립트',        rubric: '내용 40 / 문법 30 / 창의 30', state: '파싱확인필요',   risk: 'medium', parserId: 5, qa1Id: null, qaFinalId: null, dueOffset: 4 },
  { id: 266, subject: '국어',   publisher: '미래엔',    studentCode: 'S-0073', title: '고3 국어 — 논술 훈련 보고서',             scope: '전 범위',     outline: '논제 3개',                 rubric: '논리 50 / 구성 30 / 표현 20', state: '1차QA진행중',    risk: 'high',   parserId: 5, qa1Id: 7,  qaFinalId: null, dueOffset: 1 },
  { id: 267, subject: '수학',   publisher: '비상교육', studentCode: 'S-0088', title: '중2 수학 — 통계 프로젝트',                scope: '통계 단원',   outline: '설문 조사 + 분석',          rubric: '정확성 50 / 시각화 30 / 해석 20', state: '1차QA반려',      risk: 'high',   parserId: 6, qa1Id: 7,  qaFinalId: null, dueOffset: -1 },
  { id: 268, subject: '영어',   publisher: 'YBM',      studentCode: 'S-0090', title: '고2 영어 — 비평 에세이',                    scope: '5단원',       outline: '영문 500단어',             rubric: '논지 40 / 문법 30 / 어휘 30', state: '최종QA대기',     risk: 'medium', parserId: 5, qa1Id: 7,  qaFinalId: 8, dueOffset: 2 },
  { id: 269, subject: '과학',   publisher: '천재교육', studentCode: 'S-0101', title: '고1 통합과학 — 에너지 변환 실험',          scope: '에너지 단원', outline: '실험 보고서 + 계산',        rubric: '설계 30 / 결과 40 / 해석 30', state: '최종QA반려',     risk: 'high',   parserId: 5, qa1Id: 7,  qaFinalId: 8, dueOffset: -2 },
  { id: 270, subject: '사회',   publisher: '미래엔',    studentCode: 'S-0112', title: '중3 사회 — 인권 사례 탐구',                scope: '시민 단원',   outline: '사례 2건 선정',            rubric: '자료 40 / 분석 40 / 입장 20', state: '승인완료',        risk: 'low',    parserId: 6, qa1Id: 7,  qaFinalId: 8, dueOffset: -3 },
  { id: 271, subject: '수학',   publisher: '금성출판사', studentCode: 'S-0125', title: '고3 수학 — 모의평가 오답 노트',           scope: '모의 3회',    outline: '오답 분류 + 재풀이',       rubric: '분석 60 / 정확성 40',    state: '수정요청',        risk: 'medium', parserId: 5, qa1Id: 7,  qaFinalId: 8, dueOffset: 1 },
  { id: 272, subject: '국어',   publisher: '지학사',    studentCode: 'S-0130', title: '중2 국어 — 독서 토론 발표문',               scope: '문학 단원',   outline: '토론 입장 + 근거',          rubric: '근거 50 / 구성 30 / 표현 20', state: '완료',            risk: 'low',    parserId: 6, qa1Id: 7,  qaFinalId: 8, dueOffset: -5 },
  { id: 273, subject: '영어',   publisher: '능률',      studentCode: 'S-0141', title: '고1 영어 — 영시 해석',                       scope: '6단원',        outline: '영시 2편 해석',             rubric: '해석 50 / 감상 30 / 표현 20', state: '파싱진행중',      risk: 'low',    parserId: 5, qa1Id: null, qaFinalId: null, dueOffset: 3 },
  { id: 274, subject: '과학',   publisher: '비상교육', studentCode: 'S-0152', title: '중1 과학 — 상태변화 실험',                   scope: '물질 단원',   outline: '실험 절차 + 관찰',          rubric: '정확성 50 / 기록 30 / 분석 20', state: '보류',            risk: 'medium', parserId: 5, qa1Id: null, qaFinalId: null, dueOffset: 10 },
  { id: 275, subject: '한국사', publisher: '미래엔',    studentCode: 'S-0163', title: '고2 한국사 — 독립운동가 포스터',             scope: '근현대 단원', outline: '포스터 + 설명문',           rubric: '조사 40 / 디자인 30 / 메시지 30', state: '파싱완료',        risk: 'low',    parserId: 6, qa1Id: null, qaFinalId: null, dueOffset: 4 },
  { id: 276, subject: '물리',   publisher: '천재교육', studentCode: 'S-0174', title: '고2 물리 — 운동 분석',                         scope: '역학 단원',   outline: '영상 분석 + 그래프',         rubric: '측정 40 / 분석 40 / 결론 20', state: '1차QA대기',       risk: 'medium', parserId: 5, qa1Id: 7,  qaFinalId: null, dueOffset: 2 },
  { id: 277, subject: '국어',   publisher: '비상교육', studentCode: 'S-0185', title: '중3 국어 — 매체 비평',                         scope: '듣기/말하기', outline: 'SNS 콘텐츠 1건',           rubric: '비평 50 / 근거 30 / 표현 20', state: '신규접수',        risk: 'low',    parserId: null, qa1Id: null, qaFinalId: null, dueOffset: 6 },
];

export const MOCK_ASSIGNMENTS: Assignment[] = ROWS.map((r) => {
  const now = new Date().toISOString();
  return {
    id: r.id,
    code: `A-${pad(r.id)}`,
    subject: r.subject,
    publisher: r.publisher,
    studentCode: r.studentCode,
    assignmentTitle: r.title,
    assignmentScope: r.scope,
    lengthRequirement: undefined,
    outline: r.outline,
    rubric: r.rubric,
    teacherRequirements: undefined,
    studentRequests: undefined,
    state: r.state,
    risk: r.risk,
    parserId: r.parserId ?? null,
    qa1Id: r.qa1Id ?? null,
    qaFinalId: r.qaFinalId ?? null,
    dueAt: daysFromNow(r.dueOffset),
    receivedAt: now,
    completedAt: r.state === '완료' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
});
