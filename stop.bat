@echo off
title Stop FlexPulse Farm
echo ===================================================================
echo             Stopping FlexPulse Device Farm Services
echo ===================================================================
echo.

taskkill /F /IM flexpulse-coordinator.exe >nul 2>&1
taskkill /F /IM flexpulse-provider.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [*] Coordinator stopped.
echo [*] Provider stopped.
echo [*] Cloudflare Tunnel stopped.
echo.
echo All services successfully terminated.
timeout /t 2 /nobreak >nul
