@echo off
chcp 65001 >nul
REM ---------------------------------------------------------------------------
REM  EduOps v0.1.11 release helper
REM
REM  This rollup commit includes the previously-uncommitted work from v0.1.8,
REM  v0.1.9, and v0.1.10 in one shot. The v0.1.10 tag build failed on CI
REM  because those file edits never actually made it into the tagged commit.
REM
REM  Contents
REM   - v0.1.8  Notion assignments DB sync (notion-client, notion-sync,
REM             NotionSyncPage, schema.sql)
REM   - v0.1.9  IPC security hardening (auth.ts session map + requireRole,
REM             TopBar / session store renderer re-validation)
REM   - v0.1.10 In-app release trigger (release-bump.yml workflow,
REM             release IPC handlers, ReleasePage, Sidebar entry)
REM ---------------------------------------------------------------------------

echo === 1. Cleaning stale git lock files ===
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
del /f /q .git\refs\heads\main.lock 2>nul
del /f /q .git\objects\maintenance.lock 2>nul

echo === 2. git status ===
git status

echo === 3. git add (rollup: v0.1.8 + v0.1.9 + v0.1.10 + v0.1.11) ===
git add .github\workflows\release-bump.yml
git add electron\auth.ts electron\db.ts electron\ipc.ts electron\notion-client.ts electron\notion-sync.ts electron\preload.ts
git add src\renderer\App.tsx
git add src\renderer\components\Sidebar.tsx src\renderer\components\TopBar.tsx
git add src\renderer\pages\NotionSyncPage.tsx src\renderer\pages\ReleasePage.tsx
git add src\renderer\stores\session.ts
git add src\renderer\types\global.d.ts
git add src\shared\db\schema.sql
git add package.json package-lock.json
git add release-0.1.8.cmd release-0.1.9.cmd release-0.1.10.cmd release-0.1.11.cmd

echo === 4. git commit ===
git commit -m "release: v0.1.11 - rollup of v0.1.8 notion assignments + v0.1.9 security hardening + v0.1.10 in-app release trigger"

echo === 5. Tag v0.1.11 ===
git tag -a v0.1.11 -m "v0.1.11 - rollup (notion assignments + security hardening + in-app release trigger)"

echo === 6. Push ^(GitHub Actions will auto-build^) ===
git push origin main
git push origin v0.1.11

echo.
echo === Done. Check the Actions tab on GitHub for build progress. ===
echo === After the build succeeds, install the new installer to get the Release page. ===
pause
