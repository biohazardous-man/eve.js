@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"
set "WINDOW_TITLE=EvEJS Startup Loading Benchmark"
set "LATEST_LOG=%REPO_ROOT%\logs\benchmarks\startup-system-loading\startup-system-loading-latest.txt"
set "NO_PAUSE=0"

if /I not "%~1"=="--worker" (
  start "%WINDOW_TITLE%" cmd /v:on /k call "%~f0" --worker
  exit /b 0
)

if /I "%~2"=="--no-pause" set "NO_PAUSE=1"

cd /d "%REPO_ROOT%"
title %WINDOW_TITLE%
mode con: cols=148 lines=44 >nul 2>&1
chcp 65001 >nul

node "%SCRIPT_DIR%benchmark_startup_system_loading_report.js"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if exist "%LATEST_LOG%" (
  echo Latest log: "%LATEST_LOG%"
) else (
  echo Latest log was not created.
)
echo.

if "%NO_PAUSE%"=="1" exit /b %EXIT_CODE%

if exist "%LATEST_LOG%" (
  choice /c LX /n /m "Press L to open the latest log, or X to close this window: "
  if errorlevel 2 exit /b %EXIT_CODE%
  start "" notepad.exe "%LATEST_LOG%"
  echo.
)

choice /c X /n /m "Press X to close this window: "
exit /b %EXIT_CODE%
