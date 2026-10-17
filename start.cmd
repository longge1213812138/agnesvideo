@echo off
setlocal
cd /d "%~dp0"
title Agnes Video Studio

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. This tool requires Node 18 or newer.
  echo Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo First run: building, this may take a minute...
  if not exist "node_modules" (
    echo Installing dependencies...
    call pnpm install
    if errorlevel 1 (
      echo.
      echo [ERROR] Dependency install failed. Check your network and retry.
      pause
      exit /b 1
    )
  )
  call pnpm build
  if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See output above.
    pause
    exit /b 1
  )
)

echo Starting local service...
node "scripts\launch.mjs"
if errorlevel 1 (
  echo.
  echo [ERROR] Launcher exited unexpectedly. See output above.
  pause
  exit /b 1
)
