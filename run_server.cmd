@echo off
REM ============================================================
REM  Photo World - server runner (ASCII only, no CJK)
REM  Launched by start.cmd in a separate window.
REM  Usage: run_server.cmd <absolute path to node.exe>
REM ============================================================
title Photo World Server
setlocal EnableExtensions
cd /d "D:\jobs\photo_lake"

if not exist "logs" mkdir "logs" >nul 2>&1

set "NODE_EXE=%~1"
if not defined NODE_EXE set "NODE_EXE=C:\nvm4w\nodejs\node.exe"

if not exist "%NODE_EXE%" (
  echo [X] Node.js not found: %NODE_EXE%
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   Photo World server is running
echo.
echo   Close this window or press Ctrl+C to stop.
echo   Log: D:\jobs\photo_lake\logs\server.log
echo ============================================
echo.

REM Startup marker so start.cmd can confirm the child process is alive
echo started> "logs\.server_started"

"%NODE_EXE%" "src\server.js" >> "logs\server.log" 2>&1
set "RC=%ERRORLEVEL%"

del "logs\.server_started" >nul 2>&1

echo.
echo Server stopped ^(exit code %RC%^).
echo Check the log file above for the reason.
echo.
pause
endlocal
