@echo off
setlocal

echo.
echo   ========================================
echo    EVE.js CPU Load Simulator
echo    Runs for 40 seconds then stops
echo   ========================================
echo.

set /p "LOAD=  Enter CPU load %% (1-100): "

if "%LOAD%"=="" (
  echo   No value entered, defaulting to 70%%
  set "LOAD=70"
)

echo.
echo   Starting %LOAD%%% load across all cores...
echo   (will auto-stop after 40 seconds)
echo.

node "%~dp0SimulateCpuLoad.js" %LOAD%

echo.
echo   Load test complete.
echo.
pause
