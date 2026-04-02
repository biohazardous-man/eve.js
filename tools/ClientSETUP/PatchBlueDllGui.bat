@echo off
setlocal

call "%~dp0scripts\EvEJSConfig.bat"

set "EVEJS_PATCHER=%~dp0blue_dll_patch_gui.py"
set "EVEJS_BLUE_DLL=%EVEJS_CLIENT_PATH%\bin64\blue.dll"

if not "%~1"=="" (
  set "EVEJS_BLUE_DLL=%~1"
)

where pythonw >nul 2>nul
if "%errorlevel%"=="0" (
  if exist "%EVEJS_BLUE_DLL%" (
    start "" pythonw "%EVEJS_PATCHER%" --input "%EVEJS_BLUE_DLL%"
  ) else (
    start "" pythonw "%EVEJS_PATCHER%"
  )
  exit /b 0
)

if exist "%EVEJS_BLUE_DLL%" (
  python "%EVEJS_PATCHER%" --input "%EVEJS_BLUE_DLL%"
) else (
  python "%EVEJS_PATCHER%"
)
set "EVEJS_EXIT=%errorlevel%"
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo [eve.js] The blue.dll patcher exited with code %EVEJS_EXIT%.
  pause
)
exit /b %EVEJS_EXIT%
