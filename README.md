# EduOps Employee Portal

Windows 데스크톱 직원 포털 — Electron + React + TypeScript + Tailwind + SQLite.

## 기술 스택

| 레이어 | 선택 |
|--------|------|
| 셸 | Electron 32 (main + preload + renderer, `contextIsolation: true`) |
| 번들러 | Vite 5 |
| UI | React 18 + Tailwind 3 + lucide-react |
| 라우팅/상태 | React Router v6 + Zustand + TanStack Query |
| DB | better-sqlite3 12 (userData 폴더에 `eduops.db` 자동 생성) |
| 인증 | bcryptjs (Phase 1) |
| Excel | xlsx (Phase 1) |

## 폴더 구조

```
eduops-portal/
├── electron/              # main / preload (CommonJS, tsc 컴파일)
├── src/
│   ├── renderer/          # React 앱 (Vite 루트)
│   │   ├── pages/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── stores/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── styles/
│   └── shared/            # renderer ↔ main 공용 타입/상수
│       ├── types/
│       ├── mock/          # Phase 0 데모 데이터
│       └── db/            # SQL 스키마 (Phase 1)
├── scripts/               # DB init, seed, maintenance
├── db/                    # (개발) 로컬 DB — gitignore
├── reports/               # 감사/리포트 산출물 — gitignore
└── public/
```

## 개발 실행

```bash
# 1. 의존성 설치 (Node ≥ 20; better-sqlite3 12.x 는 Node 22/24 prebuilt 제공)
npm install

# 2. 개발 모드 — Vite 서버(5173) + Electron 동시 실행
npm run dev

# 3. 프로덕션 빌드
npm run build

# 4. Windows 설치 프로그램 (NSIS)
npm run build:win
```

개발 모드에서는 DevTools가 자동으로 분리 창으로 열립니다.

## 현재 진행 상황 (Phase 0)

- [x] 프로젝트 스캐폴딩 (Electron + Vite + React + TS + Tailwind)
- [x] 라우팅 + 사이드바 (19개 모듈 메뉴)
- [x] 데모 로그인 (9개 역할 빠른 전환)
- [x] 홈 대시보드 (10개 통계 카드 + 6개 위젯)
- [ ] DB 스키마 + 타입 + Mock 데이터 (Phase 1 — 다음 세션)
- [ ] 실제 bcrypt 인증 (Phase 1)
- [ ] 과제/QA/근태/휴가 실모듈 (Phase 1~3)

## 역할 (9개)

`CEO · CTO · 운영매니저 · 행정/인사 · 파싱팀 · 1차QA · 최종QA · CS · 일반직원`

자세한 권한 매트릭스는 통합 개발 프롬프트 §3 참고.

## 데모 계정

로그인 화면 하단 그리드에서 원클릭 전환. 비밀번호 값은 현재 무시됩니다(Phase 1 에서 bcrypt 해시 검증으로 교체).
