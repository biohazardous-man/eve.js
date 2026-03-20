@echo off
setlocal

set "REPO_ROOT=%~dp0..\.."
set "WINDOW_TITLE=EvEJS EVE-Survival Mission Scrape"

start "%WINDOW_TITLE%" cmd.exe /k ""%~dp0RunEveSurvivalMissionScrape.bat""

endlocal
