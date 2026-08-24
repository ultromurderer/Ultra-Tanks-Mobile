@echo off
chcp 65001 >nul
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "GAME=%ROOT%\Ultra Tanks.html"
set "ICON=%ROOT%\Ultra_Tanks.ico"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Ultra Tanks.lnk'); $s.TargetPath='%GAME%'; $s.WorkingDirectory='%ROOT%'; $s.IconLocation='%ICON%,0'; $s.Description='Ultra Tanks'; $s.Save()"
if errorlevel 1 (
  echo Не удалось создать ярлык автоматически.
  pause
  exit /b 1
)
start "" "%GAME%"
exit /b 0
