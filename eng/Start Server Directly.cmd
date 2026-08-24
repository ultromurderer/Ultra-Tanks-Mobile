@echo off
chcp 65001 >nul
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"
title Ultra Tanks LAN - Direct Node.js Start

echo.
echo Ultra Tanks LAN - direct server start
echo.
if not exist "%ROOT%\server.js" (
  echo ERROR: server.js was not found.
  echo Extract the complete game ZIP archive and try again.
  pause
  exit /b 2
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js 18 or newer from https://nodejs.org/
  pause
  exit /b 3
)

node.exe "%ROOT%\server.js"
set "CODE=%ERRORLEVEL%"
echo.
echo Server stopped. Exit code: %CODE%.
pause
exit /b %CODE%
