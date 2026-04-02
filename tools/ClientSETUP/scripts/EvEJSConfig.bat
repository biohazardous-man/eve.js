@echo off
for %%I in ("%~dp0..\..\..") do set "EVEJS_REPO_ROOT=%%~fI"

rem Leave this blank unless you want to point directly at exefile.exe.
set "EVEJS_CLIENT_EXE="

set "EVEJS_PROXY_URL=http://127.0.0.1:26002"
set "EVEJS_CA_PEM=%EVEJS_REPO_ROOT%\server\certs\xmpp-ca-cert.pem"

rem Load local path overrides (not tracked by git). Run the Client Setup wizard to create this file.
if exist "%~dp0EvEJSConfig.local.bat" call "%~dp0EvEJSConfig.local.bat"
