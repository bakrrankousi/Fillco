@echo off
rem Double-click to set up (first time) and start Fillco, then open it in the browser.
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.fillco-tools;%APPDATA%\npm;%ProgramFiles%\nodejs;%ProgramFiles%\Docker\Docker\resources\bin;%PATH%"
title Fillco

echo.
echo ==^> Checking Node.js
where node >nul 2>&1 || (set "MSG=Node.js is not installed. Install the LTS version from https://nodejs.org and try again." & goto fail)

echo.
echo ==^> Checking Docker Desktop
where docker >nul 2>&1 || (set "MSG=Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop" & goto fail)
docker info >nul 2>&1 || (set "MSG=Docker Desktop is not running. Open Docker Desktop, wait until it says it is running, then try again." & goto fail)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo.
  echo ==^> Installing pnpm ^(one time^)
  call npm install -g pnpm@10.33.0 --prefix "%USERPROFILE%\.fillco-tools" || (set "MSG=Could not install pnpm." & goto fail)
)

if not exist .env copy .env.example .env >nul

echo.
echo ==^> Starting the database
docker compose up -d || (set "MSG=Could not start the database." & goto fail)
set /a tries=0
:waitdb
docker compose exec -T postgres pg_isready -U fillco -d fillco_dev >nul 2>&1 && goto dbready
set /a tries+=1
if %tries% geq 60 goto dbready
timeout /t 2 /nobreak >nul
goto waitdb
:dbready

echo.
echo ==^> Installing libraries ^(the first time takes a few minutes^)
call pnpm install || (set "MSG=Installing libraries failed." & goto fail)
echo.
echo ==^> Building the app
call pnpm build || (set "MSG=Building the app failed." & goto fail)
echo.
echo ==^> Preparing the database
call pnpm db:migrate || (set "MSG=Preparing the database failed." & goto fail)
call pnpm db:seed || (set "MSG=Loading demo data failed." & goto fail)

echo.
echo ==^> Starting Fillco. Your browser opens in a moment. Keep this window open; close it to stop Fillco.
start "" /min cmd /c "timeout /t 25 /nobreak >nul & start http://localhost:3000"
call pnpm start
goto :eof

:fail
echo.
echo [!] %MSG%
echo.
pause
exit /b 1
