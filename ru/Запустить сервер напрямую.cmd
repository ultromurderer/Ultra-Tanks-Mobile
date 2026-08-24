@echo off
chcp 65001 >nul
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"
title Ultra Tanks LAN - Прямой запуск Node.js

echo.
echo Ultra Tanks LAN - прямой запуск сервера
echo.
if not exist "%ROOT%\server.js" (
  echo ОШИБКА: файл server.js не найден.
  echo Полностью распакуй ZIP-архив игры и повтори запуск.
  pause
  exit /b 2
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ОШИБКА: Node.js не найден.
  echo Установи Node.js 18 или новее с https://nodejs.org/
  pause
  exit /b 3
)

node.exe "%ROOT%\server.js"
set "CODE=%ERRORLEVEL%"
echo.
echo Сервер остановлен. Код: %CODE%.
pause
exit /b %CODE%
