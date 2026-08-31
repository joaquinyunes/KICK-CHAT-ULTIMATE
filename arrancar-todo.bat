@echo off
setlocal
title KICK-CHAT-ULTIMATE - KCU + KC
color 0B
cd /d "%~dp0servidor"

echo ===============================================
echo   KICK-CHAT-ULTIMATE
echo   El servidor Node (KCU) levanta y supervisa
echo   solo el pipeline de contexto (KC, modulos 1-12).
echo ===============================================
echo.

if not exist "node_modules\" (
  echo [setup] Instalando dependencias de Node...
  call npm install || goto :err
)

if not exist ".env" (
  echo [ERROR] Falta servidor\.env  ^(copia .env.example y completa las claves^)
  goto :err
)

echo [KCU] Arrancando servidor en http://localhost:3000 ...
echo [KC]  Se inicia automaticamente ^(KC_PIPELINE_ENABLED=1 en .env^)
echo.
echo       Panel de contexto:  http://localhost:3000/kc
echo       Ctrl+C para detener todo.
echo.

REM Abre el panel a los ~8s sin bloquear el arranque del server
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000/kc"

call npm run dev

goto :eof

:err
echo.
echo [FALLO] Revisa el error de arriba.
pause
exit /b 1
