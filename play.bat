@echo off
rem The Overpainted - double-click to play.
rem Starts the local server (tools/serve.mjs) and opens the game in the default browser.
rem Closing this window stops the server.
chcp 65001 >nul
title The Overpainted
cd /d "%~dp0"

set "PORT=5173"
set "URL=http://localhost:%PORT%/prototype/"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js가 설치되어 있지 않습니다.
  echo  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

rem Already running (another window, or an editor preview): just open the game.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  start "" "%URL%"
  exit /b 0
)

rem Open the browser a moment after the server starts.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 800; Start-Process '%URL%'"

echo.
echo  The Overpainted 실행 중: %URL%
echo  이 창을 닫으면 게임이 꺼집니다.
echo.
node tools/serve.mjs %PORT%
if errorlevel 1 pause
