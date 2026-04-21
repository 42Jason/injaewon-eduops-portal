@echo off
REM ---------------------------------------------------------------------------
REM  EduOps v0.1.8 release helper
REM  실행 위치: C:\Users\wotjd\Desktop\-_-\eduops-portal\release-0.1.8.cmd
REM ---------------------------------------------------------------------------

echo === 1. Cleaning stale git lock files ===
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
del /f /q .git\refs\heads\main.lock 2>nul
del /f /q .git\objects\maintenance.lock 2>nul

echo === 2. git status ===
git status

echo === 3. git add + commit ===
git add electron\db.ts electron\ipc.ts electron\notion-sync.ts electron\preload.ts package-lock.json package.json src\renderer\pages\NotionSyncPage.tsx src\renderer\types\global.d.ts src\shared\db\schema.sql

git commit -m "release: v0.1.8 - 노션 과제 의뢰 DB 풀 싱크 (학생·과제 upsert)"

echo === 4. Tag v0.1.8 ===
git tag -a v0.1.8 -m "v0.1.8 - 노션 과제 의뢰 DB 풀 싱크"

echo === 5. Push (GitHub Actions 가 자동 릴리스 빌드) ===
git push origin main
git push origin v0.1.8

echo.
echo === Done. GitHub Actions 빌드 진행 상황은 저장소의 Actions 탭에서 확인하세요. ===
pause
