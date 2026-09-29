@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 exit /b 1
if not exist ".runtime\electron-v44.4.5-win32-x64\electron.exe" (
  echo Run scripts\prepare-offscreen-runtime.ps1 first to prepare the pinned runtime.
  goto failed
)
call npm run pack:harness
if errorlevel 1 goto failed
set "GAMEHUB_NATIVE_PROBE_PROJECT="
set "GAMEHUB_OFFSCREEN_PROJECT=%~dp0"
set "GAMEHUB_HARNESS_PROFILE=gamehub-offscreen-check"
set "GAMEHUB_HARNESS_PORT=3083"
node "%~dp0scripts\start-harness-m0.mjs" %*
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
