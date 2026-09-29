@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 exit /b 1
node "%~dp0scripts\start-harness-m0.mjs" %*
if errorlevel 1 pause
