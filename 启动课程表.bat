@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto usefixed
set "NODE=node"
goto run
:usefixed
if exist "D:\node.js\node.exe" (
  set "NODE=D:\node.js\node.exe"
) else (
  echo [x] 没找到 Node.js，请先安装 Node.js，或直接用浏览器打开 index.html
  pause
  exit /b 1
)
:run
echo ============================================
echo   课程表 . 本地服务
echo   电脑访问： http://localhost:8080/
echo   手机访问： 见下面打印的局域网地址
echo ============================================
start "" http://localhost:8080/
"%NODE%" tools\serve.mjs 8080

echo.
echo 服务已停止。
pause