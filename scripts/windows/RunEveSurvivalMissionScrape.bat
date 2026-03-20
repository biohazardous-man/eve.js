@echo off
setlocal EnableExtensions EnableDelayedExpansion

chcp 65001 >nul
title EvEJS EVE-Survival Mission Scrape
mode con: cols=132 lines=42 >nul 2>&1

set "REPO_ROOT=%~dp0..\.."
pushd "%REPO_ROOT%"

for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"

set "BG=%ESC%[48;2;8;12;24m"
set "FG1=%ESC%[38;2;120;220;255m"
set "FG2=%ESC%[38;2;255;210;120m"
set "FG3=%ESC%[38;2;140;255;180m"
set "FG4=%ESC%[38;2;190;170;255m"
set "MUTED=%ESC%[38;2;150;165;190m"
set "RESET=%ESC%[0m"

cls
echo %BG%%FG1%====================================================================================================%RESET%
echo %BG%%FG1%                                   EvEJS Mission Archive Runner                                    %RESET%
echo %BG%%FG1%====================================================================================================%RESET%
echo %BG%%FG2%  Source   %RESET% %FG3%EVE-Survival mission reports%RESET%
echo %BG%%FG2%  Output   %RESET% %MUTED%data\eve-survival\missions%RESET%
echo %BG%%FG2%  Mode     %RESET% %FG4%full restart from page 1 with live progress%RESET%
echo %BG%%FG1%----------------------------------------------------------------------------------------------------%RESET%
echo.
echo %MUTED%Progress format:%RESET% [1/640] [Mission Level: 1] [Name: Example1] - starting ... archived
echo.

node .\scripts\dev\scrape-eve-survival-missions.js --force %*

echo.
if /I "%EVEJS_NO_PAUSE%"=="1" goto done
echo %FG3%Crawl window finished. Press any key to close...%RESET%
pause >nul

:done

popd
endlocal
