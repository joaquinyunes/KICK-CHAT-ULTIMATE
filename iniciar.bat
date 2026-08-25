@echo off
title KICK CHAT ULTIMATE
cd /d "%~dp0servidor"
echo ========================================
echo   KICK CHAT ULTIMATE - Iniciando...
echo ========================================
node dist/server-engine.js
pause
