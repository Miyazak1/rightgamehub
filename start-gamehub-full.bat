@echo off
setlocal EnableExtensions DisableDelayedExpansion
title GameHub - Full Local Stack
cd /d "%~dp0"
if errorlevel 1 goto failed

echo.
echo [GameHub] Checking local requirements...
where node.exe >nul 2>nul || (
  echo [ERROR] Node.js was not found in PATH.
  goto failed
)
where npm.cmd >nul 2>nul || (
  echo [ERROR] npm was not found in PATH.
  goto failed
)
where docker.exe >nul 2>nul || (
  echo [ERROR] Docker was not found. Install and start Docker Desktop first.
  goto failed
)
docker info >nul 2>nul || (
  echo [ERROR] Docker Desktop is not running.
  goto failed
)

echo [1/5] Starting PostgreSQL...
docker compose -f "%~dp0deploy\compose.dev.yml" up -d postgres
if errorlevel 1 goto failed

echo [2/5] Waiting for PostgreSQL to become ready...
for /L %%I in (1,1,45) do (
  docker compose -f "%~dp0deploy\compose.dev.yml" exec -T postgres pg_isready -U gamehub -d gamehub >nul 2>nul && goto database_ready
  timeout /t 1 /nobreak >nul
)
echo [ERROR] PostgreSQL did not become ready within 45 seconds.
goto failed

:database_ready
echo [3/5] Building the latest Harness plugin...
call npm run pack:harness
if errorlevel 1 goto failed

echo [4/5] Starting GameHub API, runtime edge and validation worker...
curl.exe --silent --fail --noproxy "*" http://127.0.0.1:3090/health >nul 2>nul
if not errorlevel 1 goto api_ready
start "GameHub API" /min "%ComSpec%" /d /k "cd /d ""%~dp0"" && npm run e2e:start"

for /L %%I in (1,1,60) do (
  curl.exe --silent --fail --noproxy "*" http://127.0.0.1:3090/health >nul 2>nul && goto api_ready
  timeout /t 1 /nobreak >nul
)
echo [ERROR] GameHub API did not become healthy on port 3090.
echo Check the minimized "GameHub API" window for details.
goto failed

:api_ready
echo [5/5] Starting Harness on http://127.0.0.1:3081 ...
if not defined GITHUB_CLIENT_ID echo [INFO] GITHUB_CLIENT_ID is not set. Catalog and email login work, but GitHub login needs this value.
echo.
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3081 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 goto harness_already_running
echo Keep this window open. Ctrl+C stops Harness; the minimized API window and PostgreSQL remain available.
echo.
call "%~dp0start-gamehub-m0.bat"
exit /b %errorlevel%

:harness_already_running
echo [READY] Harness is already running on port 3081, so no second instance was started.
echo Refresh the existing browser page to reconnect to the API.
echo To reload a newly built plugin, stop the existing Harness window first and run this BAT again.
echo.
pause
exit /b 0

:failed
echo.
echo GameHub full-stack startup failed.
pause
exit /b 1
