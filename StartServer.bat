@echo off
setlocal EnableDelayedExpansion
title EvEJS - Start Server

rem ── Resolve repo root from this script's location ────────────────
for %%I in ("%~dp0.") do set "EVEJS_REPO_ROOT=%%~fI"
set "SCRIPTS=%EVEJS_REPO_ROOT%\scripts\windows"

rem ── Load config ──────────────────────────────────────────────────
call "%SCRIPTS%\EvEJSConfig.bat"

rem ── Banner ───────────────────────────────────────────────────────
echo.
echo   ============================================================
echo     EvEJS - Start Server
echo   ============================================================
echo.

rem ── Check Node.js ────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo   [!] Node.js is not installed or not on PATH.
  echo       The server requires Node.js to run.
  echo       Download it from https://nodejs.org
  pause
  exit /b 1
)

rem ── Check server directory exists ────────────────────────────────
if not exist "%EVEJS_REPO_ROOT%\server\index.js" (
  echo   [!] Server not found at %EVEJS_REPO_ROOT%\server
  pause
  exit /b 1
)

rem ── Ask if the user is also playing on this machine ──────────────
echo   Are you also playing on this machine?
echo.
echo     [1] Server only  -  just run the server
echo     [2] Server + Play -  run the server AND launch the game
echo.
set "PLAY_CHOICE=0"
set /p "PLAY_CHOICE=  Choose [1/2]: "

echo.

rem ── Start the server ─────────────────────────────────────────────
set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
if not exist "%EVEJS_REPO_ROOT%\server\logs\node-reports" mkdir "%EVEJS_REPO_ROOT%\server\logs\node-reports" >nul 2>&1

if "%PLAY_CHOICE%"=="2" (
  echo   Starting server in background...
  start "EvEJS Server" cmd /c "cd /d "%EVEJS_REPO_ROOT%\server" && set EVEJS_PROXY_LOCAL_INTERCEPT=1 && npm start"
  echo   Server starting up...
  echo.

  rem Give the server a few seconds to initialize
  ping -n 5 127.0.0.1 >nul 2>&1

  echo   Launching Play.bat...
  echo.
  call "%EVEJS_REPO_ROOT%\Play.bat"
) else (
  echo   Starting server...
  echo   Press Ctrl+C to stop.
  echo.
  echo   ============================================================
  echo     Server is running. Players can connect now.
  echo   ============================================================
  echo.

  pushd "%EVEJS_REPO_ROOT%\server"
  call npm start
  set "EVEJS_EXIT=!errorlevel!"
  popd

  if not "!EVEJS_EXIT!"=="0" (
    echo.
    echo   Server exited with code !EVEJS_EXIT!.
    pause
  )

  exit /b !EVEJS_EXIT!
)

exit /b 0
