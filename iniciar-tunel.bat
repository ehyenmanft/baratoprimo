@echo off
title BaratoPrimo - Tunel Venezuela (CNE y SENIAT)
color 0A
cls
echo =====================================================================
echo   BaratoPrimo - Tunel de Consulta Fiscal Oficial (CNE / SENIAT)
echo =====================================================================
echo.
echo Iniciando servidor de puente local en el puerto 3030...
echo Mantenga esta ventana abierta mientras use el sistema para consultar.
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0tunel-bridge.ps1"
pause
