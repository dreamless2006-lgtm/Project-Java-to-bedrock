@echo off
rem Real AI bridge: double-click to install (first time) and start. Needs Node.js 20+ from nodejs.org.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo Installing... & call npm install || (pause & exit /b 1))
node index.mjs
pause
