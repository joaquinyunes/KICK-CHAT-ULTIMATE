@echo off
setlocal enabledelayedexpansion

REM Colores y títulos
title KICK-CHAT-ULTIMATE - Iniciando KCU + KC
color 0B

echo.
echo ===============================================
echo   KICK-CHAT-ULTIMATE - Dual Launcher
echo ===============================================
echo.
echo [1] Iniciando Servidor Node.js (KCU)...
echo [2] Iniciando Orquestador Python (KC)...
echo.

REM Cambiar a directorio del proyecto
cd /d "%~dp0"

REM Ventana 1: Servidor Node.js
start "KCU - KICK-CHAT-ULTIMATE Server" cmd /k "cd servidor && npm run dev"

REM Esperar un poco antes de lanzar Python
timeout /t 3 /nobreak

REM Ventana 2: Orquestador Python
start "KC - KICK CONTEXT Orchestrator" cmd /k "cd kick-context\src && python modulo10_orquestador\orquestador.py"

echo.
echo ===============================================
echo [✓] Ambos proyectos iniciados
echo.
echo KCU Server:  http://localhost:3000 (revisar .env)
echo KC Panel:    http://127.0.0.1:5000
echo.
echo Cierra estas ventanas para detener los servicios.
echo ===============================================
echo.

pause
