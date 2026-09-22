@echo off
setlocal
cd /d "%~dp0"
where npx >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for the LocalTunnel launcher.
  echo Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo Starting a public HTTPS tunnel for this folder...
echo Keep this window open while testing on your phone.
start "A Little Journey local server" cmd /k "python -m http.server 8080"
timeout /t 2 /nobreak >nul
npx --yes localtunnel --port 8080
pause
