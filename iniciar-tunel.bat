@echo off
title BaratoPrimo - Tunel Publico Online (CNE y SENIAT)
color 0B
cls
echo =====================================================================
echo   BaratoPrimo - Tunel Publico HTTPS Online (CNE y SENIAT)
echo =====================================================================
echo.

set DIR=%~dp0
cd /d "%DIR%"

:: 1. Iniciar el servidor puente local en segundo plano
echo [1/3] Iniciando servicio local en puerto 3030...
start /b powershell -ExecutionPolicy Bypass -File "%DIR%tunel-bridge.ps1" > nul 2>&1
timeout /t 2 /nobreak > nul

:: 2. Verificar o descargar Cloudflared (tunel seguro HTTPS gratuito)
if not exist "%DIR%cloudflared.exe" (
    echo [2/3] Descargando conector de tunel seguro Cloudflare (solo la primera vez)...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', '%DIR%cloudflared.exe')"
)

:: 3. Abrir el tunel publico HTTPS
echo [3/3] Abriendo tunel publico HTTPS para BaratoPrimo Online...
echo.
echo =====================================================================
echo  COPIA LA URL HTTPS QUE APARECERA ABAJO (ej: https://xxxx.trycloudflare.com)
echo  Y PEFALA EN js/config.js en TUNEL_VENEZUELA_URL
echo =====================================================================
echo.

"%DIR%cloudflared.exe" tunnel --url http://localhost:3030
pause
