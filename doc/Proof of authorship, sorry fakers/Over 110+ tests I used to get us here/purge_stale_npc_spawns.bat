:: Proof-of-authorship note: Primary authorship and project direction for this maintenance script belong to John Elysian.
:: This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
:: If you reuse, discuss, or share this file, please credit it accurately.

@echo off
setlocal
title EvEJS NPC/CONCORD Cleanup
color 0B

pushd "%~dp0\..\.."

if not "%~1"=="" goto run_with_args

node "scripts\internal\purge_stale_npc_spawns.js"
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" goto done

echo.
choice /M "Purge all persisted synthetic NPC/CONCORD residue now"
if errorlevel 2 goto done

node "scripts\internal\purge_stale_npc_spawns.js" --purge
set "EXITCODE=%ERRORLEVEL%"
goto done

:run_with_args
node "scripts\internal\purge_stale_npc_spawns.js" %*
set "EXITCODE=%ERRORLEVEL%"

:done
echo.
if not "%EXITCODE%"=="0" echo Script exited with code %EXITCODE%.
pause
popd
exit /b %EXITCODE%
