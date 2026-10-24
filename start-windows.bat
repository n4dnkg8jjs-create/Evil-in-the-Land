@echo off
title Evil in the Land - server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org and try again. & pause & exit /b)
start "" "http://localhost:7777/?host"
node server.js
pause
