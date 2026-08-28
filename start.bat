@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   BiliSummarize - B站视频要点总结
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org
  echo        安装完成后重新运行本脚本。
  pause
  exit /b 1
)

if not exist "temp" mkdir temp

echo [1/2] 正在启动本地服务（http://localhost:3000）...
start "" "http://localhost:3000"

echo [2/2] 服务已启动，浏览器即将打开页面。
echo       请确认 LM Studio 已运行并加载了 qwen3.6-35b-a3b 模型。
echo       关闭本窗口即可停止服务。
echo.
node server.js

pause
