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
echo  ULTRA TANKS - LAN STARTER
echo ============================================================
echo.

if not exist "%SERVER_JS%" (
  echo ERROR: server.js was not found in the game folder.
  echo Extract the complete ZIP archive before launching the game.
  goto :failed
)

if exist "%PS_SCRIPT%" (
  where powershell.exe >nul 2>&1
  if not errorlevel 1 (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Language eng
    set "EXIT_CODE=%ERRORLEVEL%"
    if "%EXIT_CODE%"=="0" goto :finished
    echo.
    echo PowerShell starter returned error code %EXIT_CODE%.
    echo Trying direct Node.js startup...
    echo.
  ) else (
    echo PowerShell was not found. Trying direct Node.js startup...
    echo.
  )
) else (
  echo Start-Network-Game.ps1 was not found.
  echo Trying direct Node.js startup...
  echo.
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js 18 or newer, then run this file again.
  echo Official site: https://nodejs.org/
  goto :failed
)

node.exe "%SERVER_JS%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto :failed
goto :finished

:failed
echo.
echo ============================================================
echo  LAN SERVER WAS NOT STARTED. ERROR CODE: %EXIT_CODE%
echo ============================================================
echo Take a photo of all text in this window if diagnostics are needed.
echo.
pause
exit /b %EXIT_CODE%

:finished
echo.
echo Ultra Tanks LAN server stopped.
pause
exit /b 0
