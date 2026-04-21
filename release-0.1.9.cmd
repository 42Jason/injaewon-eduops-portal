@echo off
REM ---------------------------------------------------------------------------
REM  EduOps v0.1.9 release helper
REM  실행 위치: C:\Users\wotjd\Desktop\-_-\eduops-portal\release-0.1.9.cmd
REM
REM  주요 변경 (v0.1.9 - 보안 하드닝)
REM   - webContents.id 기반 세션 맵 + requireRole / requireActor 가드
REM   - 민감 IPC (payroll, corpCards, subscriptions, tuition, attendance,
REM     leave, employees.update, students.delete) 일괄 가드
REM   - auth:me 로 renderer 세션 재검증 (localStorage 위조 차단)
REM ---------------------------------------------------------------------------

echo === 1. Cleaning stale git lock files ===
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
del /f /q .git\refs\heads\main.lock 2>nul
del /f /q .git\objects\maintenance.lock 2>nul

echo === 2. git status ===
git status

echo === 3. git add + commit ===
git add electron\auth.ts electron\ipc.ts electron\notion-client.ts electron\notion-sync.ts electron\preload.ts package-lock.json package.json release-0.1.9.cmd src\renderer\App.tsx src\renderer\components\TopBar.tsx src\renderer\pages\NotionSyncPage.tsx src\renderer\stores\session.ts src\renderer\types\global.d.ts

git commit -m "release: v0.1.9 - IPC 보안 하드닝 (세션 맵 + requireRole + auth:me)"

echo === 4. Tag v0.1.9 ===
git tag -a v0.1.9 -m "v0.1.9 - IPC 보안 하드닝"

echo === 5. Push (GitHub Actions 가 자동 릴리스 빌드) ===
git push origin main
git push origin v0.1.9

echo.
echo === Done. GitHub Actions 빌드 진행 상황은 저장소의 Actions 탭에서 확인하세요. ===
pause
