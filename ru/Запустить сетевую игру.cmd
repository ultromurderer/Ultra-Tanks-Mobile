@echo off
chcp 65001 >nul
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"
title Ultra Tanks LAN

set "PS_SCRIPT=%ROOT%\Start-Network-Game.ps1"
set "SERVER_JS=%ROOT%\server.js"
set "EXIT_CODE=1"

echo.
echo ============================================================
echo  ULTRA TANKS - ЗАПУСК LAN
echo ============================================================
echo.

if not exist "%SERVER_JS%" (
  echo ОШИБКА: server.js не найден в папке игры.
  echo Полностью распакуй ZIP-архив перед запуском.
  goto :failed
)

if exist "%PS_SCRIPT%" (
  where powershell.exe >nul 2>&1
  if not errorlevel 1 (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Language ru
    set "EXIT_CODE=%ERRORLEVEL%"
    if "%EXIT_CODE%"=="0" goto :finished
    echo.
    echo PowerShell-запуск завершился с ошибкой %EXIT_CODE%.
    echo Пробую прямой запуск через Node.js...
    echo.
  ) else (
    echo PowerShell не найден. Пробую прямой запуск через Node.js...
    echo.
  )
) else (
  echo Start-Network-Game.ps1 не найден.
  echo Пробую прямой запуск через Node.js...
  echo.
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ОШИБКА: Node.js не найден.
  echo Установи Node.js 18 или новее и снова запусти этот файл.
  echo Официальный сайт: https://nodejs.org/
  goto :failed
)

node.exe "%SERVER_JS%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto :failed
goto :finished

:failed
echo.
echo ============================================================
echo  LAN-СЕРВЕР НЕ ЗАПУЩЕН. КОД ОШИБКИ: %EXIT_CODE%
echo ============================================================
echo Сфотографируй весь текст в этом окне, если нужна диагностика.
echo.
pause
exit /b %EXIT_CODE%

:finished
echo.
echo LAN-сервер Ultra Tanks остановлен.
pause
exit /b 0
