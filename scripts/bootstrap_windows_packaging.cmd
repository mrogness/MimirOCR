@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0bootstrap_windows_packaging.ps1" %*
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo Bootstrap failed with exit code %EXIT_CODE%.
)
exit /b %EXIT_CODE%
