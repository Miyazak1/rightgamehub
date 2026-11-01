@echo off
setlocal
cd /d "%~dp0"
node scripts\build-desktop-shell.mjs
if errorlevel 1 exit /b 1
node scripts\start-desktop-shell.mjs
