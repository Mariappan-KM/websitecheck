@echo off
REM SiteWatch India - double-click to start the local server and open the dashboard
cd /d "%~dp0"
start "" http://127.0.0.1:8790
python server.py
pause
