@echo off
setlocal EnableDelayedExpansion
title EvEJS - Play

rem ── Resolve repo root from this script's location ────────────────
for %%I in ("%~dp0.") do set "EVEJS_REPO_ROOT=%%~fI"
set "SCRIPTS=%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts"

rem ── Load config ──────────────────────────────────────────────────
call "%SCRIPTS%\EvEJSConfig.bat"

rem ── Banner ───────────────────────────────────────────────────────
echo.
echo   ============================================================
echo     EvEJS - Play
echo   ============================================================
echo.

rem ── First-run: check if setup has been completed ─────────────────
set "NEEDS_SETUP=0"

rem Check if client path is configured and valid
if not defined EVEJS_CLIENT_PATH (
  set "NEEDS_SETUP=1"
) else if not exist "%EVEJS_CLIENT_PATH%" (
  set "NEEDS_SETUP=1"
)

rem Check if CA cert exists
if not exist "%EVEJS_CA_PEM%" (
  set "NEEDS_SETUP=1"
)

rem Check for client executable
set "CLIENT_EXE="
if defined EVEJS_CLIENT_EXE if exist "%EVEJS_CLIENT_EXE%" set "CLIENT_EXE=%EVEJS_CLIENT_EXE%"
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin64\exefile.exe" set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin64\exefile.exe"
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin\exefile.exe" set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin\exefile.exe"
if not defined CLIENT_EXE set "NEEDS_SETUP=1"

if "%NEEDS_SETUP%"=="1" (
  echo   [!] First-time setup required.
  echo       Please run the Client Setup wizard in tools\ClientSETUP first.
  pause
  exit /b 1
)

rem ── Validate everything before launching ─────────────────────────
if not exist "%CLIENT_EXE%" (
  echo   [!] Client executable not found: %CLIENT_EXE%
  echo       Run the setup wizard again or edit scripts\windows\EvEJSConfig.bat
  pause
  exit /b 1
)

if not exist "%EVEJS_CA_PEM%" (
  echo   [!] Certificate file missing: %EVEJS_CA_PEM%
  echo       Run the setup wizard again to install certificates.
  pause
  exit /b 1
)

rem ── Configure proxy environment for the client ───────────────────
set "EVEJS_PROXY_LOCAL_INTERCEPT=1"

for %%I in ("%CLIENT_EXE%") do set "CLIENT_DIR=%%~dpI"
for %%I in ("%CLIENT_DIR%..") do set "CLIENT_ROOT=%%~fI"

set "SSL_CERT_FILE=%EVEJS_CA_PEM%"
set "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH=%EVEJS_CA_PEM%"
set "REQUESTS_CA_BUNDLE=%EVEJS_CA_PEM%"
set "http_proxy=%EVEJS_PROXY_URL%"
set "https_proxy=%EVEJS_PROXY_URL%"
set "HTTP_PROXY=%EVEJS_PROXY_URL%"
set "HTTPS_PROXY=%EVEJS_PROXY_URL%"
set "no_proxy=127.0.0.1,localhost,::1"
set "NO_PROXY=127.0.0.1,localhost,::1"

rem ── Launch the client ────────────────────────────────────────────
echo   Launching EVE client...
echo.
echo     Client: %CLIENT_EXE%
echo     Proxy:  %EVEJS_PROXY_URL%
echo     CA:     %SSL_CERT_FILE%
echo.
echo   ============================================================
echo     Game is running. This window will close when you exit.
echo   ============================================================
echo.

cd /d "%CLIENT_DIR%"
"%CLIENT_EXE%"
set "EVEJS_EXIT=%errorlevel%"

echo.
if "%EVEJS_EXIT%"=="0" (
  echo   Client exited cleanly. See you next time!
) else (
  echo   Client exited with code %EVEJS_EXIT%.
)

timeout /t 3 >nul
exit /b %EVEJS_EXIT%
