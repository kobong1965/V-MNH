@echo off
chcp 65001 >nul
title Vela AI视频画布 - 运行中
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [Vela] 未找到 Node.js / npm，请先安装 Node.js。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Vela] 首次运行，正在安装依赖……
  call npm.cmd install
  if errorlevel 1 (
    echo [Vela] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [Vela] 正在启动前端和本机控制服务……
echo [Vela] 浏览器会在服务准备完成后自动打开。
echo [Vela] 要停止软件，请在本窗口按 Ctrl+C，或关闭本窗口。
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\open-vela-browser.ps1"
call npm.cmd run dev

echo.
echo [Vela] 服务已经停止。
pause
