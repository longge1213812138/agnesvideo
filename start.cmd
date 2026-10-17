@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Agnes Video Studio

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。本工具需要 Node 18 或更高版本。
  echo 请从 https://nodejs.org 安装后重试。
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo 首次运行，正在构建……这可能需要一分钟。
  if not exist "node_modules" (
    echo 正在安装依赖……
    call pnpm install
    if errorlevel 1 (
      echo.
      echo [错误] 依赖安装失败。请检查网络后重试。
      pause
      exit /b 1
    )
  )
  call pnpm build
  if errorlevel 1 (
    echo.
    echo [错误] 构建失败，请查看上方输出。
    pause
    exit /b 1
  )
)

echo 正在启动本地服务……
node "scripts\launch.mjs"
if errorlevel 1 (
  echo.
  echo [错误] 启动器异常退出，请查看上方输出。
  pause
  exit /b 1
)
