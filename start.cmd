@echo off
REM ============================================================
REM  Photo World - one-click launcher (ASCII only, no CJK)
REM  Double-click to start the server and open the browser.
REM
REM  NOTE: This file must stay ASCII-only. cmd.exe parses batch
REM  files with the ANSI code page; non-ASCII characters can
REM  corrupt the execution flow.
REM ============================================================

setlocal EnableExtensions EnableDelayedExpansion
cd /d "D:\jobs\photo_lake"

if not exist "logs" mkdir "logs" >nul 2>&1

set "PORT=3000"
if defined PHOTO_PORT set "PORT=%PHOTO_PORT%"
set "URL=http://127.0.0.1:%PORT%/"

echo ============================================
echo    Photo World
echo    URL: %URL%
echo ============================================
echo.

REM ---------- 1. locate Node ----------
set "BOOT_NODE="
if exist "C:\nvm4w\nodejs\node.exe" set "BOOT_NODE=C:\nvm4w\nodejs\node.exe"
if not defined BOOT_NODE if exist "C:\Program Files\nodejs\node.exe" set "BOOT_NODE=C:\Program Files\nodejs\node.exe"
if not defined BOOT_NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "BOOT_NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined BOOT_NODE if exist "%APPDATA%\nvm\node.exe" set "BOOT_NODE=%APPDATA%\nvm\node.exe"
if not defined BOOT_NODE if exist "C:\nvm\node.exe" set "BOOT_NODE=C:\nvm\node.exe"

if not defined BOOT_NODE (
  echo [X] Node.js was not found.
  echo.
  echo Install Node.js 18 or newer from: https://nodejs.org/
  echo Keep the default options, then double-click this file again.
  echo.
  pause
  exit /b 1
)

REM Read the result from a temp file: "for /f" with backquotes is
REM unreliable for capturing output on long paths.
del "%TEMP%\pw_node.txt" >nul 2>&1
"%BOOT_NODE%" "%~dp0pick-node.js" > "%TEMP%\pw_node.txt" 2>nul
set "NODE_EXE="
if exist "%TEMP%\pw_node.txt" set /p NODE_EXE=<"%TEMP%\pw_node.txt"
del "%TEMP%\pw_node.txt" >nul 2>&1

if not defined NODE_EXE (
  echo [X] No Node.js version matches the compiled native modules.
  echo.
  echo This project uses the better-sqlite3 native module, which must
  echo match the Node.js version exactly.
  echo Fix: run this in the project folder:  node install_deps.js
  echo Then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo [1/4] Node.js in use:
echo     %NODE_EXE%
"%NODE_EXE%" -v
echo.

REM ---------- 2. dependencies ----------
if not exist "node_modules\fastify\package.json" goto INSTALL
if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto INSTALL
echo [2/4] Dependencies are ready
echo.
goto DEPS_OK

:INSTALL
echo [2/4] First run: installing dependencies, please wait...
echo.
"%NODE_EXE%" "%~dp0install_deps.js"
if not "!ERRORLEVEL!"=="0" (
  echo.
  echo [X] Dependency installation failed. Check your network and retry.
  echo.
  pause
  exit /b 1
)
echo.

:DEPS_OK
REM ---------- 3. port check ----------
echo [3/4] Checking port %PORT% ...
call :portstate "%NODE_EXE%" %PORT%
if "!PORTSTATE!"=="TAKEN" goto ALREADY

echo     Port is free, starting the server...
echo.

if exist "logs\.server_started" del "logs\.server_started" >nul 2>&1

REM IMPORTANT: the syntax must be start "title" /min call "script" args
REM Without "call", the first quoted argument is consumed as the window
REM title and the command fails with "The syntax of the command is incorrect".
start "Photo World" /min call "%~dp0run_server.cmd" "%NODE_EXE%"

set "KILLED="
for /l %%i in (1,1,10) do (
  if not defined KILLED (
    if exist "logs\.server_started" set "KILLED=1"
    if not defined KILLED ping -n 2 127.0.0.1 >nul 2>&1
  )
)

if not defined KILLED goto SPAWN_FAIL

echo [4/4] Waiting for the server to be ready, up to 30 seconds ...
set "READY="
for /l %%i in (1,1,30) do (
  if not defined READY (
    call :portstate "%NODE_EXE%" %PORT%
    if "!PORTSTATE!"=="TAKEN" set "READY=1"
    if not defined READY ping -n 2 127.0.0.1 >nul 2>&1
  )
)
if defined READY goto OPEN

echo.
echo [X] The server started but is not listening on the port.
echo     Log: D:\jobs\photo_lake\logs\server.log
echo.
echo Double-click run_server.cmd in this folder to see the exact error.
echo.
pause
exit /b 1

:SPAWN_FAIL
echo.
echo [X] The server window could not be launched.
echo.
echo Likely causes:
echo   - Blocked by antivirus or Windows Security; allow this folder
echo   - The Node.js path contains special characters
echo.
echo You can double-click run_server.cmd in this folder to see the error.
echo.
pause
exit /b 1

:ALREADY
echo     Port %PORT% is already in use, Photo World may be running.
echo     Opening the browser.
echo.
start "" "%URL%"
echo Done. This window will close automatically.
ping -n 3 127.0.0.1 >nul 2>&1
exit /b 0

:OPEN
echo     Server is ready, opening the browser ...
echo.
start "" "%URL%"
echo ============================================
echo   Photo World is running
echo.
echo   URL: %URL%
echo   Log: D:\jobs\photo_lake\logs\server.log
echo ============================================
echo.
echo The server runs in a separate window ^(minimized, see taskbar^).
echo To stop it: click the "Photo World" window in the taskbar, press Ctrl+C.
echo.
pause
endlocal

REM ============================================================
REM  :portstate <node.exe> <port>  ->  sets PORTSTATE to FREE/TAKEN/UNKNOWN
REM ============================================================
:portstate
set "PORTSTATE="
set "_pf=%TEMP%\pw_port.txt"
del "%_pf%" >nul 2>&1
%~1 "%~dp0portcheck.js" %~2 > "%_pf%" 2>nul
if exist "%_pf%" set /p PORTSTATE=<"%_pf%"
del "%_pf%" >nul 2>&1
if not defined PORTSTATE set "PORTSTATE=UNKNOWN"
goto :eof
