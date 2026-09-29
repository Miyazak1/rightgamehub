@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-native-probe.ps1"
if errorlevel 1 goto failed
call npm run pack:harness
if errorlevel 1 goto failed
set "GAMEHUB_NATIVE_PROBE_PROJECT=%~dp0"
node "%~dp0scripts\start-harness-m0.mjs" %*
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
