@echo off
REM ---------------------------------------------------------------------------
REM  EduOps v0.1.16 release helper (ASCII-only)
REM
REM  ASCII-only on purpose: Korean Windows CMD parses .cmd files as CP949,
REM  so non-ASCII comments become mojibake and get interpreted as commands.
REM
REM  Two paths:
REM  [A] Build the EXE locally and install (bypasses Actions entirely)
REM  [B] git push + tag -> Actions publishes to GitHub Releases (if working)
REM
REM  Usage:
REM    release-0.1.16.cmd          (default: A then B)
REM    release-0.1.16.cmd local    (A only)
REM    release-0.1.16.cmd push     (B only)
REM ---------------------------------------------------------------------------

setlocal EnableExtensions EnableDelayedExpansion
set MODE=%~1
if "%MODE%"=="" set MODE=both

REM ===========================================================================
REM v0.1.16 changes
REM ===========================================================================
REM  1) Migration baseline - new `schema_migrations` log table plus a
REM     `runMigration(version, fn)` helper. Every schema change from now on
REM     is recorded with a version id and a timestamp so DB upgrades become
REM     idempotent and auditable. Legacy DBs get backfilled on first run.
REM     (electron/db.ts)
REM
REM  2) Notifications v2 schema - `notifications` table rebuilt with
REM     category / entity_type / entity_id / dedupe_key / priority /
REM     snooze_until / dismissed_at columns plus a partial unique index
REM     (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND
REM     dismissed_at IS NULL. Legacy rows are migrated in-place.
REM     (electron/db.ts, src/shared/db/schema.sql)
REM
REM  3) Notifications producer hooks - approvals / assignments / qa /
REM     cs_tickets / tuition_invoices now call `recordNotification(...)`
REM     outside their main business transactions, and resolve events
REM     automatically call `dismissEntityNotifications(...)` so stale
REM     alarms disappear when the underlying entity is done.
REM     New helper `notifyAssignmentStateChange` routes the alarm to
REM     parser / qa1 / qa_final depending on the new state.
REM     (electron/ipc.ts)
REM
REM  4) TopBar alarm drawer rewrite - numeric badge (99+ cap), category
REM     filter tabs (approval/assignment/cs/tuition/notice/system),
REM     per-row hover actions (mark-read / 1h snooze / dismiss),
REM     priority indicator, line-clamped body, auto mark-read on open,
REM     polling 10s badge + 15s list while drawer open.
REM     notifications:* IPC family (list/stats/markRead/dismiss/snooze)
REM     exposed via preload + global.d.ts.
REM     (src/renderer/components/TopBar.tsx, electron/preload.ts,
REM      src/renderer/types/global.d.ts, electron/ipc.ts)
REM ===========================================================================

if /i "%MODE%"=="local" goto DO_LOCAL
if /i "%MODE%"=="push"  goto DO_PUSH

:DO_LOCAL
echo === [A1] Check build deps ===
if not exist node_modules (
  echo node_modules missing - running npm install
  call npm install
  if errorlevel 1 goto FAIL
)

echo === [A2] typecheck ===
call npm run typecheck
if errorlevel 1 goto FAIL

echo === [A3] Build local EXE (electron-builder --publish never) ===
call npm run dist
if errorlevel 1 goto FAIL

echo.
echo === Local build done. Installer at: ===
dir /b release\EduOps-Portal-Setup-0.1.16.exe
echo.
echo   %%CD%%\release\EduOps-Portal-Setup-0.1.16.exe
echo.
echo   1) Double-click the file above to install.
echo   2) If the window still closes right after launch, check:
echo        %%APPDATA%%\eduops-portal\crash.log
echo.

if /i "%MODE%"=="local" goto DONE

:DO_PUSH
echo === [B1] Clean stale git locks ===
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
del /f /q .git\refs\heads\main.lock 2>nul

echo === [B2] git status ===
git status

echo === [B3] git add (v0.1.16 - migration baseline + notifications v2 + TopBar drawer) ===
git add electron\ipc.ts electron\preload.ts electron\db.ts
git add src\shared\db\schema.sql
git add src\renderer\types\global.d.ts
git add src\renderer\components\TopBar.tsx
git add package.json package-lock.json
git add release-0.1.16.cmd fix-and-install-now.cmd

echo === [B4] git commit ===
git commit -m "release: v0.1.16 - migration baseline, notifications v2 (dedupe/snooze/entity), producer hooks, TopBar drawer rewrite"

echo === [B5] tag v0.1.16 ===
git tag -a v0.1.16 -m "v0.1.16 - schema_migrations + notifications v2 + alarm drawer"

echo === [B6] push (main + tag) ===
git push origin main
git push origin v0.1.16

echo.
echo === Done. Check GitHub -> Actions for build progress. ===
echo === If Actions does not run, install the local release\*.exe built above. ===

goto DONE

:FAIL
echo.
echo *** FAILED - see the error message above. ***
exit /b 1

:DONE
echo.
pause
