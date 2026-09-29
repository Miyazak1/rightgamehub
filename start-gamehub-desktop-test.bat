@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 exit /b 1
call npm run pack:harness
if errorlevel 1 goto failed
set "GAMEHUB_NATIVE_PROBE_PROJECT="
set "GAMEHUB_OFFSCREEN_PROJECT="
set "GAMEHUB_DESKTOP_LAUNCH=1"
set "GAMEHUB_HARNESS_PROFILE=gamehub-desktop-check"
set "GAMEHUB_HARNESS_PORT=3085"
echo EXE launches are manual and open independent game windows.
node "%~dp0scripts\start-harness-m0.mjs" %*
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
