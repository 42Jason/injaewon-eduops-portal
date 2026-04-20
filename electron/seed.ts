import type { Database as Db } from 'better-sqlite3';
import bcrypt from 'bcryptjs';

/**
 * Seed minimal demo data if the DB is empty. Idempotent: only inserts when
 * each table is empty. Password for every demo user: "demo1234".
 */
export function seedIfEmpty(db: Db) {
  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount > 0) return;

  console.log('[seed] users table empty — inserting demo data');

  const DEPARTMENTS = [
    [1, '경영'],
    [2, '운영'],
    [3, '행정/인사'],
    [4, '파싱팀'],
    [5, 'QA'],
    [6, 'CS'],
  ] as const;

  const USERS = [
    { id: 1,  email: 'ceo@eduops.kr',     name: '김대표', role: 'CEO',         dept: 1, title: '대표이사'   },
    { id: 2,  email: 'cto@eduops.kr',     name: '이기술', role: 'CTO',         dept: 1, title: 'CTO'        },
    { id: 3,  email: 'ops@eduops.kr',     name: '박운영', role: 'OPS_MANAGER', dept: 2, title: '운영매니저' },
    { id: 4,  email: 'hr@eduops.kr',      name: '최인사', role: 'HR_ADMIN',    dept: 3, title: '인사담당'   },
    { id: 5,  email: 'parser1@eduops.kr', name: '정파싱', role: 'PARSER',      dept: 4, title: '파싱팀장'   },
    { id: 6,  email: 'parser2@eduops.kr', name: '오미연', role: 'PARSER',      dept: 4, title: '파싱원'     },
    { id: 7,  email: 'qa1@eduops.kr',     name: '강QA1',  role: 'QA1',         dept: 5, title: '1차 QA'     },
    { id: 8,  email: 'qafinal@eduops.kr', name: '윤최종', role: 'QA_FINAL',    dept: 5, title: '최종 QA'    },
    { id: 9,  email: 'cs@eduops.kr',      name: '장CS',   role: 'CS',          dept: 6, title: 'CS 매니저'  },
    { id: 10, email: 'staff@eduops.kr',   name: '한직원', role: 'STAFF',       dept: 2, title: '주임'       },
  ];

  const hash = bcrypt.hashSync('demo1234', 10);

  const insDept = db.prepare('INSERT OR IGNORE INTO departments (id, name) VALUES (?, ?)');
  const insUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, department_id, title, active)
     VALUES (@id, @email, @hash, @name, @role, @dept, @title, 1)`,
  );
  const insSetting = db.prepare(
    `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
     VALUES (?, ?, datetime('now'))`,
  );

  const tx = db.transaction(() => {
    for (const [id, name] of DEPARTMENTS) insDept.run(id, name);
    for (const u of USERS) insUser.run({ ...u, hash });
    insSetting.run('sla.parsing_hours', JSON.stringify(24));
    insSetting.run('sla.qa1_hours', JSON.stringify(12));
    insSetting.run('sla.qa_final_hours', JSON.stringify(12));
    insSetting.run('brand.name', JSON.stringify('EduOps'));

    // Seed a handful of assignments so lists aren't empty on first launch
    const insA = db.prepare(
      `INSERT INTO assignments (code, subject, publisher, student_code, title, scope, state, risk,
                                parser_id, qa1_id, qa_final_id, due_at)
       VALUES (@code,@subject,@publisher,@student_code,@title,@scope,@state,@risk,
               @parser_id,@qa1_id,@qa_final_id,@due_at)`,
    );
    const now = new Date();
    const due = (d: number) => {
      const x = new Date(now);
      x.setDate(x.getDate() + d);
      x.setHours(18, 0, 0, 0);
      return x.toISOString();
    };
    const seedAssignments = [
      { code: 'A-0241', subject: '물리', publisher: '비상교육', student_code: 'S-0012', title: '중3 물리 수행평가 — 관성의 법칙', scope: '1단원 전체',   state: '1차QA대기',    risk: 'high',   parser_id: 5, qa1_id: 7,    qa_final_id: 8,    due_at: due(0) },
      { code: 'A-0245', subject: '국어', publisher: '천재교육', student_code: 'S-0023', title: '고1 국어 — 독서 포트폴리오',       scope: '읽기 2단원',    state: '파싱진행중',    risk: 'medium', parser_id: 5, qa1_id: null, qa_final_id: null, due_at: due(1) },
      { code: 'A-0251', subject: '영어', publisher: 'YBM',      student_code: 'S-0017', title: '중2 영어 — 자기소개 에세이',        scope: '4단원',         state: '최종QA진행중',  risk: 'low',    parser_id: 6, qa1_id: 7,    qa_final_id: 8,    due_at: due(1) },
      { code: 'A-0260', subject: '수학', publisher: '금성출판사', student_code: 'S-0031', title: '고2 수학 — 심화 탐구 보고서',         scope: '미적분 3단원', state: '파싱완료',      risk: 'low',    parser_id: 6, qa1_id: null, qa_final_id: null, due_at: due(2) },
      { code: 'A-0262', subject: '사회', publisher: '지학사',    student_code: 'S-0008', title: '중1 사회 — 우리 지역 조사 보고서',     scope: '3단원',         state: '자료누락',      risk: 'medium', parser_id: null, qa1_id: null, qa_final_id: null, due_at: due(5) },
      { code: 'A-0267', subject: '수학', publisher: '비상교육', student_code: 'S-0088', title: '중2 수학 — 통계 프로젝트',             scope: '통계 단원',     state: '1차QA반려',     risk: 'high',   parser_id: 6, qa1_id: 7,    qa_final_id: null, due_at: due(-1) },
      { code: 'A-0270', subject: '사회', publisher: '미래엔',    student_code: 'S-0112', title: '중3 사회 — 인권 사례 탐구',            scope: '시민 단원',     state: '승인완료',      risk: 'low',    parser_id: 6, qa1_id: 7,    qa_final_id: 8,    due_at: due(-3) },
      { code: 'A-0272', subject: '국어', publisher: '지학사',    student_code: 'S-0130', title: '중2 국어 — 독서 토론 발표문',          scope: '문학 단원',     state: '완료',          risk: 'low',    parser_id: 6, qa1_id: 7,    qa_final_id: 8,    due_at: due(-5) },
    ];
    for (const a of seedAssignments) insA.run(a);

    // Parsing results — for a few assignments that have reached 파싱완료 or beyond.
    // content_json mirrors the 10-field Excel schema (§9) so the detail panel has something real to show.
    const insPR = db.prepare(
      `INSERT INTO parsing_results (assignment_id, version, content_json, ai_summary, confidence, parsed_by)
         SELECT a.id, 1, @content, @summary, @conf, @parser
           FROM assignments a WHERE a.code = @code`,
    );
    const parsingSeeds = [
      {
        code: 'A-0241',
        parser: 5,
        conf: 0.86,
        summary: '관성의 법칙 실험 보고서 — 변인통제 설명이 약함. 평가기준 3번(결론) 보강 필요.',
        content: {
          subject: '물리', publisher: '비상교육', studentCode: 'S-0012',
          assignmentTitle: '중3 물리 수행평가 — 관성의 법칙',
          assignmentScope: '1단원 전체', lengthRequirement: 'A4 3매',
          outline: '1) 실험 설계 2) 변인 통제 3) 관찰 데이터 4) 해석 5) 결론',
          rubric: '실험 설계 30 / 분석 40 / 결론 30',
          teacherRequirements: '표는 반드시 Word 표로 작성. 사진 최소 2장.',
          studentRequests: '그래프 그리는 법 도움 요청',
        },
      },
      {
        code: 'A-0260',
        parser: 6,
        conf: 0.91,
        summary: '미적분 실생활 사례 — 정확성 확보됨, 서술이 다소 건조.',
        content: {
          subject: '수학', publisher: '금성출판사', studentCode: 'S-0031',
          assignmentTitle: '고2 수학 — 심화 탐구 보고서',
          assignmentScope: '미적분 3단원', lengthRequirement: 'A4 5매',
          outline: '주제 선정 → 수학적 모델링 → 풀이 → 해석',
          rubric: '수학적 정확성 60 / 표현 40',
          teacherRequirements: '풀이 과정 반드시 손글씨 스캔본 첨부',
          studentRequests: '모델링 예시 자료 필요',
        },
      },
      {
        code: 'A-0270',
        parser: 6,
        conf: 0.94,
        summary: '인권 사례 2건 — 논리/자료 모두 양호. 최종 승인 가능.',
        content: {
          subject: '사회', publisher: '미래엔', studentCode: 'S-0112',
          assignmentTitle: '중3 사회 — 인권 사례 탐구',
          assignmentScope: '시민 단원', lengthRequirement: 'A4 2매',
          outline: '사례 선정 → 배경 → 쟁점 → 본인 입장',
          rubric: '자료 40 / 분석 40 / 입장 20',
          teacherRequirements: '출처 3개 이상 명시',
          studentRequests: '-',
        },
      },
    ];
    for (const p of parsingSeeds) {
      insPR.run({
        code: p.code,
        content: JSON.stringify(p.content),
        summary: p.summary,
        conf: p.conf,
        parser: p.parser,
      });
    }

    // QA review history — a rejection trail for A-0267 (통계 프로젝트) and approval for A-0270
    const insQR = db.prepare(
      `INSERT INTO qa_reviews (assignment_id, stage, reviewer_id, result, comment)
         SELECT a.id, @stage, @reviewer, @result, @comment
           FROM assignments a WHERE a.code = @code`,
    );
    insQR.run({ code: 'A-0267', stage: 'QA1',      reviewer: 7, result: 'rejected', comment: '통계 해석 2번 항목 수치 오류 — 재작성 필요' });
    insQR.run({ code: 'A-0270', stage: 'QA1',      reviewer: 7, result: 'approved', comment: '자료/분석/입장 모두 기준 충족' });
    insQR.run({ code: 'A-0270', stage: 'QA_FINAL', reviewer: 8, result: 'approved', comment: '최종 승인' });

    // Notices
    const insN = db.prepare(
      `INSERT INTO notices (title, body_md, author_id, audience, pinned, published_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
    );
    insN.run('[전사] 5월 창립기념일 휴무 안내', '5월 8일(금) 전사 휴무', 4, 'ALL', 1, '-2 days');
    insN.run('[파싱팀] Excel 템플릿 v3 배포',   'v2 는 4/25 이후 자동 반려', 2, 'PARSER', 0, '-3 days');
    insN.run('[QA] 최종QA 체크리스트 v1.4',    '가중치 반영 항목 추가',     3, 'QA_FINAL', 0, '-4 days');

    // ----- Attendance records (지난 10 영업일 치 샘플) -------------------------
    const insAT = db.prepare(
      `INSERT OR IGNORE INTO attendance_records
         (user_id, work_date, check_in, check_out, break_min, note)
       VALUES (@uid, @date, @in, @out, @brk, @note)`,
    );
    const pad = (n: number) => String(n).padStart(2, '0');
    const toDateStr = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const toTimeIso = (baseDate: Date, hh: number, mm: number) => {
      const x = new Date(baseDate);
      x.setHours(hh, mm, 0, 0);
      return x.toISOString();
    };
    // Last 10 working days (skip weekends) for users 5,6,7,8,10
    const atUsers = [5, 6, 7, 8, 10];
    let d = new Date(now);
    let inserted = 0;
    while (inserted < 10) {
      d.setDate(d.getDate() - 1);
      const wd = d.getDay();
      if (wd === 0 || wd === 6) continue; // skip weekend
      inserted++;
      for (const uid of atUsers) {
        // small jitter so rows look natural
        const inMin = 55 + ((uid * 7 + inserted) % 20); // 8:55~9:14
        const outHr = 18 + (((uid + inserted) % 3) === 0 ? 1 : 0); // mostly 18시, 가끔 19시
        const outMin = 5 + ((uid + inserted * 3) % 50);
        insAT.run({
          uid,
          date: toDateStr(d),
          in:  toTimeIso(d, 8, inMin),
          out: toTimeIso(d, outHr, outMin),
          brk: 60,
          note: null,
        });
      }
    }
    // Today — only 파싱팀 are already checked in, 나머지는 아직 출근 전
    const today = toDateStr(now);
    insAT.run({
      uid: 5, date: today,
      in:  toTimeIso(now, 9, 2), out: null, brk: 0, note: null,
    });
    insAT.run({
      uid: 6, date: today,
      in:  toTimeIso(now, 9, 11), out: null, brk: 0, note: null,
    });

    // ----- Leave requests ----------------------------------------------------
    const insLR = db.prepare(
      `INSERT INTO leave_requests
         (user_id, kind, start_date, end_date, days, reason, status, approver_id, decided_at)
       VALUES (@uid, @kind, @s, @e, @days, @reason, @status, @approver, @decided)`,
    );
    const isoDaysAgo = (delta: number) => {
      const x = new Date(now);
      x.setDate(x.getDate() + delta);
      return toDateStr(x);
    };
    // Upcoming approved: staff (10), annual 2 days, approved by HR(4)
    insLR.run({
      uid: 10, kind: 'annual', s: isoDaysAgo(10), e: isoDaysAgo(11), days: 2,
      reason: '가족 여행', status: 'approved', approver: 4, decided: new Date(now.getTime() - 3 * 86400e3).toISOString(),
    });
    // Pending: parser2(6), half_pm 0.5 day, waiting for HR/CEO
    insLR.run({
      uid: 6, kind: 'half_pm', s: isoDaysAgo(4), e: isoDaysAgo(4), days: 0.5,
      reason: '병원 진료', status: 'pending', approver: null, decided: null,
    });
    // Rejected: qa1(7), sick 1 day, rejected
    insLR.run({
      uid: 7, kind: 'sick', s: isoDaysAgo(-2), e: isoDaysAgo(-2), days: 1,
      reason: '감기', status: 'rejected', approver: 3, decided: new Date(now.getTime() - 1 * 86400e3).toISOString(),
    });
    // Pending: staff(10), annual 1 day upcoming
    insLR.run({
      uid: 10, kind: 'annual', s: isoDaysAgo(14), e: isoDaysAgo(14), days: 1,
      reason: '개인 사정', status: 'pending', approver: null, decided: null,
    });

    // Deduct balance for the already-approved leave (10 used 2d out of 15 default)
    db.prepare(
      `UPDATE users SET leave_balance = leave_balance - 2 WHERE id = 10`,
    ).run();

    // ----- CS tickets --------------------------------------------------------
    const insCS = db.prepare(
      `INSERT INTO cs_tickets
         (code, channel, student_code, inquirer, subject, body, priority, status,
          assignee_id, related_assignment_id, opened_at, resolved_at)
       VALUES (@code, @channel, @sc, @inq, @subj, @body, @prio, @status,
               @assignee, @related, @opened, @resolved)`,
    );
    const csSeeds = [
      { code: 'CS-0001', channel: 'kakao', sc: 'S-0012', inq: '김학부모', subj: '과제 일정 문의', body: '관성의 법칙 수행평가 마감일 연장 가능한지', prio: 'high',    status: 'in_progress', assignee: 9,    related: null, opened: '-2 days', resolved: null },
      { code: 'CS-0002', channel: 'email', sc: 'S-0023', inq: '이학부모', subj: '포트폴리오 제출 방법',    body: '워드 파일로 제출해도 되는지 확인 요청', prio: 'normal',  status: 'open',        assignee: 9,    related: null, opened: '-1 days', resolved: null },
      { code: 'CS-0003', channel: 'phone', sc: 'S-0088', inq: '박학부모', subj: '통계 프로젝트 반려 이유',   body: 'QA 반려 사유 상세 설명 요청', prio: 'urgent', status: 'waiting',     assignee: 9,    related: null, opened: '-3 hours', resolved: null },
      { code: 'CS-0004', channel: 'email', sc: 'S-0112', inq: '최학부모', subj: '인권 사례 제출 완료 확인',   body: '제출 완료 여부 회신 부탁드립니다',   prio: 'low',     status: 'resolved',    assignee: 9,    related: null, opened: '-5 days', resolved: '-4 days' },
      { code: 'CS-0005', channel: 'other', sc: null,     inq: '방문학생', subj: '수행평가 일반 문의',         body: '현장 방문 상담 요청', prio: 'normal',  status: 'closed',      assignee: 9,    related: null, opened: '-10 days', resolved: '-8 days' },
    ];
    for (const c of csSeeds) {
      insCS.run({
        code: c.code,
        channel: c.channel,
        sc: c.sc,
        inq: c.inq,
        subj: c.subj,
        body: c.body,
        prio: c.prio,
        status: c.status,
        assignee: c.assignee,
        related: c.related,
        opened: new Date(Date.parse(now.toISOString()) + (
          c.opened.includes('days') ? parseInt(c.opened) * 86400e3 :
          c.opened.includes('hours') ? parseInt(c.opened) * 3600e3 : 0
        )).toISOString(),
        resolved: c.resolved ? new Date(Date.parse(now.toISOString()) + parseInt(c.resolved) * 86400e3).toISOString() : null,
      });
    }

    // ----- Approvals (전자결재) -----------------------------------------------
    const insAP = db.prepare(
      `INSERT INTO approvals (code, title, kind, drafter_id, payload_json, status, drafted_at, closed_at)
       VALUES (@code, @title, @kind, @drafter, @payload, @status, @drafted, @closed)`,
    );
    const insStep = db.prepare(
      `INSERT INTO approval_steps (approval_id, step_order, approver_id, state, comment, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // AP-0001: 휴가 결재 (approved)
    const ap1 = insAP.run({
      code: 'AP-0001',
      title: '연차 2일 신청 — 한직원',
      kind: '휴가',
      drafter: 10,
      payload: JSON.stringify({ days: 2, period: '10일 뒤' }),
      status: 'approved',
      drafted: new Date(now.getTime() - 5 * 86400e3).toISOString(),
      closed: new Date(now.getTime() - 3 * 86400e3).toISOString(),
    });
    insStep.run(Number(ap1.lastInsertRowid), 1, 3, 'approved', '일정 확인 완료', new Date(now.getTime() - 4 * 86400e3).toISOString());
    insStep.run(Number(ap1.lastInsertRowid), 2, 4, 'approved', '승인', new Date(now.getTime() - 3 * 86400e3).toISOString());

    // AP-0002: 지출 결재 (pending, drafter=parser2)
    const ap2 = insAP.run({
      code: 'AP-0002',
      title: '파싱 장비 구매 — 듀얼모니터 2대',
      kind: '지출',
      drafter: 6,
      payload: JSON.stringify({ amount: 680000, items: '모니터 2대' }),
      status: 'pending',
      drafted: new Date(now.getTime() - 1 * 86400e3).toISOString(),
      closed: null,
    });
    insStep.run(Number(ap2.lastInsertRowid), 1, 3, 'approved', '필요성 확인', new Date(now.getTime() - 12 * 3600e3).toISOString());
    insStep.run(Number(ap2.lastInsertRowid), 2, 1, 'pending', null, null);

    // AP-0003: 연장근무 결재 (pending, 1차 대기)
    const ap3 = insAP.run({
      code: 'AP-0003',
      title: '최종QA 특근 요청 — 4/28',
      kind: '연장근무',
      drafter: 8,
      payload: JSON.stringify({ date: '2026-04-28', hours: 4 }),
      status: 'pending',
      drafted: new Date(now.getTime() - 3 * 3600e3).toISOString(),
      closed: null,
    });
    insStep.run(Number(ap3.lastInsertRowid), 1, 3, 'pending', null, null);
    insStep.run(Number(ap3.lastInsertRowid), 2, 1, 'pending', null, null);

    // ----- Checklist templates -----------------------------------------------
    const insCL = db.prepare(
      `INSERT INTO checklist_templates (stage, name, items_json, version, active)
       VALUES (?, ?, ?, ?, 1)`,
    );
    insCL.run(
      'QA1',
      '1차 QA 체크리스트 v1.0',
      JSON.stringify([
        { id: 'q1-1', label: '학생 코드/과목/출판사 정보가 정확한가', required: true },
        { id: 'q1-2', label: '수행평가명·범위 정확', required: true },
        { id: 'q1-3', label: '분량 요구사항 반영 확인', required: true },
        { id: 'q1-4', label: '평가기준(rubric) 모든 항목 충족', required: true },
        { id: 'q1-5', label: '교사 요구사항 누락 없음', required: false },
        { id: 'q1-6', label: '서술 가독성(문단·문맥)', required: false },
      ]),
      1,
    );
    insCL.run(
      'QA_FINAL',
      '최종 QA 체크리스트 v1.4',
      JSON.stringify([
        { id: 'qf-1', label: '1차 QA 지적사항 반영',                 required: true },
        { id: 'qf-2', label: '맞춤법/문법 오류 없음',                 required: true },
        { id: 'qf-3', label: '표/이미지 첨부 규정 준수',              required: true },
        { id: 'qf-4', label: '학생 요구사항 반영',                    required: false },
        { id: 'qf-5', label: '최종 본문 분량 적정',                   required: true },
        { id: 'qf-6', label: '출처·저작권 표기 정확',                 required: true },
        { id: 'qf-7', label: '대표 관점에서 학부모 발송 적합',        required: false },
      ]),
      1,
    );

    // ----- Manual pages ------------------------------------------------------
    const insM = db.prepare(
      `INSERT INTO manual_pages (slug, title, body_md, category, author_id, version)
       VALUES (?, ?, ?, ?, ?, 1)`,
    );
    insM.run('welcome', '포털 시작하기',
      `# EduOps 포털에 오신 것을 환영합니다

이 문서는 신규 입사자가 EduOps 내부 포털을 사용하기 위한 기본 가이드입니다.

## 첫 로그인
- 이메일 / 비밀번호는 HR 에서 발급받은 초기값을 사용합니다.
- 로그인 후 반드시 프로필에서 비밀번호를 변경하세요.

## 주요 메뉴
- **과제 관리** — 파싱/QA 대상 과제 목록
- **안내문 파싱 센터** — Excel 업로드 → 구조화
- **근태/휴가** — 출퇴근 체크인, 휴가 신청
- **전자 결재** — 지출·연차·연장근무 결재
`,
      '시작하기', 4,
    );
    insM.run('ops-sla', '운영 SLA 기준',
      `# 운영 SLA 기준

| 단계 | 기준 시간 |
| --- | --- |
| 파싱 | 24시간 |
| 1차 QA | 12시간 |
| 최종 QA | 12시간 |

SLA 초과 건은 운영 보드에서 **빨간색 배지**로 표시됩니다.
`,
      '운영', 3,
    );
    insM.run('qa-checklist', 'QA 체크리스트 운영 규칙',
      `# QA 체크리스트 운영 규칙

- 필수 항목은 모두 체크되어야 승인 가능합니다.
- 반려 시 반드시 코멘트를 작성하세요.
- 최종 QA 반려는 파싱팀 재작업이 아닌 **수정요청**으로 분기될 수 있습니다.
`,
      'QA', 3,
    );
    insM.run('cs-sop', 'CS 응대 기본 원칙',
      `# CS 응대 기본 원칙

1. 모든 문의는 **24시간 이내** 최초 응답한다.
2. 학부모 응대는 존댓말/차분한 톤을 유지한다.
3. 과제 관련 문의는 반드시 담당 파서/최종 QA 를 참조한다.
`,
      'CS', 9,
    );

    // ----- Documents stubs ---------------------------------------------------
    const insDoc = db.prepare(
      `INSERT INTO documents (name, stored_path, folder, tags, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insDoc.run('파싱_템플릿_v3.xlsx',       'local://templates/parse_v3.xlsx',    '템플릿', 'Excel,파싱', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 48500,  2);
    insDoc.run('최종QA_체크리스트_v1.4.pdf', 'local://templates/final_qa_v14.pdf', 'QA',     'PDF,QA',     'application/pdf',                                                     127000, 3);
    insDoc.run('학부모_안내문_샘플.docx',    'local://templates/parent_sample.docx', 'CS',     'Word,CS',    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 34000, 9);

    // ----- Activity logs seed -----------------------------------------------
    const insLog = db.prepare(
      `INSERT INTO activity_logs (actor_id, action, target, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insLog.run(5, 'assignment.state_change', 'assignment:A-0245', JSON.stringify({ from: '파싱대기', to: '파싱진행중' }), new Date(now.getTime() - 2 * 3600e3).toISOString());
    insLog.run(7, 'qa.submit', 'assignment:A-0270', JSON.stringify({ stage: 'QA1', result: 'approved' }), new Date(now.getTime() - 5 * 3600e3).toISOString());
    insLog.run(8, 'qa.submit', 'assignment:A-0270', JSON.stringify({ stage: 'QA_FINAL', result: 'approved' }), new Date(now.getTime() - 4 * 3600e3).toISOString());
    insLog.run(9, 'cs.create', 'cs:1', JSON.stringify({ code: 'CS-0001' }), new Date(now.getTime() - 2 * 86400e3).toISOString());
    insLog.run(4, 'approvals.decide', 'approval:1', JSON.stringify({ decision: 'approved', finalStatus: 'approved' }), new Date(now.getTime() - 3 * 86400e3).toISOString());
  });
  tx();
}
