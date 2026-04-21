@echo off
REM ---------------------------------------------------------------------------
REM  EduOps Portal - one-click rescue script (ASCII-only)
REM
REM  NOTE: this file is intentionally ASCII-only. Korean Windows CMD parses
REM  .cmd files with the system ANSI code page (CP949), so any non-ASCII
REM  comment or echo line was being decoded as garbage and then interpreted
REM  as commands. English-only text avoids that entirely.
REM
REM  Double-click this file from inside the repo folder. It will:
REM    1) back up the existing DB and add missing columns + deleted_records
REM       (repair-db.js)
REM    2) run `npm install` if node_modules is missing
REM    3) build the v0.1.15 EXE locally
REM    4) open the release\ folder in Explorer
REM
REM  When the explorer window pops up, double-click
REM      EduOps-Portal-Setup-0.1.15.exe
REM  to install.
REM ---------------------------------------------------------------------------

setlocal EnableExtensions EnableDelayedExpansion

REM Move to the directory that holds this .cmd file (= repo root).
cd /d "%~dp0"

echo.
echo === [1/4] Repair existing DB ===
echo   Backs up %%APPDATA%%\eduops-portal\db\eduops.db and adds missing columns.
where node >nul 2>&1
if errorlevel 1 (
  echo   [!] 'node' is not on PATH. Install Node.js LTS and retry.
  echo       https://nodejs.org/
  goto FAIL
)
call node scripts\repair-db.js
if errorlevel 1 (
  echo   [!] DB repair reported an error. If the DB file does not exist yet,
  echo       this is expected - continuing.
)

echo.
echo === [2/4] Install dependencies ===
if not exist node_modules (
  echo   node_modules missing - running npm install
  call npm install
  if errorlevel 1 goto FAIL
) else (
  echo   node_modules present - skipping
)

echo.
echo === [3/4] Build local EXE (v0.1.15) ===
call npm run dist
if errorlevel 1 goto FAIL

echo.
echo === [4/4] Open release folder ===
if exist "release\EduOps-Portal-Setup-0.1.15.exe" (
  echo   Installer produced:
  dir /b release\EduOps-Portal-Setup-0.1.15.exe
  start "" explorer "%CD%\release"
  echo.
  echo   In the Explorer window, double-click EduOps-Portal-Setup-0.1.15.exe
  echo   to install.
) else (
  echo   [!] Installer was not produced at the expected path.
  echo       Contents of release\:
  dir /b release\
)

goto DONE

:FAIL
echo.
echo *** FAILED - copy the last error message above and send it to the dev team. ***
echo.
pause
exit /b 1

:DONE
echo.
pause
