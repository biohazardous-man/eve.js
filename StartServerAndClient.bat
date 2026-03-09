@echo off
setlocal
call "%~dp0scripts\windows\StartServerAndClient.bat" %*
exit /b %errorlevel%
