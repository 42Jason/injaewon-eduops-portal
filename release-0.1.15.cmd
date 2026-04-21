@echo off
REM ---------------------------------------------------------------------------
REM  EduOps v0.1.15 release helper (ASCII-only)
REM
REM  ASCII-only on purpose: Korean Windows CMD parses .cmd files as CP949,
REM  so non-ASCII comments become mojibake and get interpreted as commands.
REM
REM  Two paths:
REM  [A] Build the EXE locally and install (bypasses Actions entirely)
REM  [B] git push + tag -> Actions publishes to GitHub Releases (if working)
REM
REM  Usage:
REM    release-0.1.15.cmd          (default: A then B)
REM    release-0.1.15.cmd local    (A only)
REM    release-0.1.15.cmd push     (B only)
REM ---------------------------------------------------------------------------

setlocal EnableExtensions EnableDelayedExpansion
set MODE=%~1
if "%MODE%"=="" set MODE=both

REM ===========================================================================
REM v0.1.15 changes
REM ===========================================================================
REM  1) Trash / Recovery system - new `deleted_records` tombstone table.
REM     Every hard-DELETE across Operations Board, CS, Administration,
REM     Knowledge, Org, Students, Parsing now snapshots the row first via
REM     recordDeletion(...) before the actual DELETE. Restorable from the
REM     new TrashPage.
REM     (electron/ipc.ts, electron/db.ts)
REM
REM  2) trash:* IPC family - list / stats / restore / purge / purgeAll.
REM     Restore handles PK collisions (allocates a new id when the original
REM     is in use) and clears any soft `deleted_at` column via PRAGMA
REM     introspection.
REM     (electron/ipc.ts, electron/preload.ts, src/renderer/types/global.d.ts)
REM
REM  3) TrashPage UI - new top-level page under the "Operations" sidebar
REM     group, opsAdmin-only (CEO / CTO / OPS_MANAGER). Category filter,
REM     search, bulk-purge, per-row restore + permanent-delete.
REM     (src/renderer/pages/TrashPage.tsx, src/renderer/App.tsx,
REM      src/renderer/components/Sidebar.tsx)
REM
REM  4) scripts/repair-db.js - now also creates the `deleted_records`
REM     table + indexes, so legacy DBs work without a full reinstall.
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
dir /b release\EduOps-Portal-Setup-0.1.15.exe
echo.
echo   %%CD%%\release\EduOps-Portal-Setup-0.1.15.exe
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

echo === [B3] git add (v0.1.15 - Trash / Recovery system) ===
git add electron\ipc.ts electron\preload.ts
git add src\renderer\types\global.d.ts
git add src\renderer\App.tsx
git add src\renderer\components\Sidebar.tsx
git add src\renderer\pages\TrashPage.tsx
git add scripts\repair-db.js
git add package.json package-lock.json
git add release-0.1.15.cmd fix-and-install-now.cmd

echo === [B4] git commit ===
git commit -m "release: v0.1.15 - Trash / Recovery system (deleted_records tombstone + TrashPage)"

echo === [B5] tag v0.1.15 ===
git tag -a v0.1.15 -m "v0.1.15 - Trash / Recovery system across all modules"

echo === [B6] push (main + tag) ===
git push origin main
git push origin v0.1.15

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
