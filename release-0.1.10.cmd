@echo off
chcp 65001 >nul
REM ---------------------------------------------------------------------------
REM  EduOps v0.1.10 release helper
REM
REM  Changes in v0.1.10 - in-app release trigger
REM   - .github/workflows/release-bump.yml  npm version + tag push
REM   - release IPC handlers with safeStorage-encrypted GitHub PAT
REM   - ReleasePage.tsx (leadership only, rocket icon in sidebar)
REM ---------------------------------------------------------------------------

echo === 1. Cleaning stale git lock files ===
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
del /f /q .git\refs\heads\main.lock 2>nul
del /f /q .git\objects\maintenance.lock 2>nul

echo === 2. git status ===
git status

echo === 3. git add + commit ===
git add .github\workflows\release-bump.yml electron\ipc.ts electron\preload.ts package-lock.json package.json release-0.1.10.cmd src\renderer\App.tsx src\renderer\components\Sidebar.tsx src\renderer\pages\ReleasePage.tsx src\renderer\types\global.d.ts

git commit -m "release: v0.1.10 - in-app release trigger (ReleasePage + workflow_dispatch)"

echo === 4. Tag v0.1.10 ===
git tag -a v0.1.10 -m "v0.1.10 - in-app release trigger"

echo === 5. Push ^(GitHub Actions will auto-build^) ===
git push origin main
git push origin v0.1.10

echo.
echo === Done. Check the Actions tab on GitHub for build progress. ===
echo === Next: open the portal, go to Release page, save a GitHub PAT once. ===
echo === After that, future releases can be triggered from the button. ===
pause
