@echo off
setlocal enabledelayedexpansion
title FlexPulse Farm Launcher
cd /d "%~dp0"

echo ===================================================================
echo               FlexPulse Mobile Device Farm Host
echo ===================================================================
echo.

:: ---------------------------------------------------------------------
:: 1. Load Supabase Environment
:: ---------------------------------------------------------------------
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        set "ENV_KEY=%%A"
        if not "!ENV_KEY:~0,1!"=="#" (
            set "%%A=%%B"
        )
    )
)

if "%COORDINATOR_POSTGRES_URI%"=="" (
    set "COORDINATOR_POSTGRES_URI=postgresql://postgres.sqnkpkzjnypxhhwvnfob:6JWPgTz1VGmmNvco@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
)
if "%COORDINATOR_SUPABASE_URL%"=="" (
    set "COORDINATOR_SUPABASE_URL=https://sqnkpkzjnypxhhwvnfob.supabase.co"
)

:: ---------------------------------------------------------------------
:: 2. Check Core Binaries
:: ---------------------------------------------------------------------
echo [1/3] Verifying device farm binaries...

if not exist "bin\flexpulse-coordinator.exe" (
    echo [*] Compiling coordinator...
    go build -buildvcs=false -ldflags "-s -w" -o bin\flexpulse-coordinator.exe .\cmd\coordinator
)
if not exist "bin\flexpulse-provider.exe" (
    echo [*] Compiling provider...
    go build -buildvcs=false -ldflags "-s -w" -o bin\flexpulse-provider.exe .\cmd\provider
)

if not exist "bin\flexpulse-coordinator.exe" (
    echo [x] Error: flexpulse-coordinator.exe failed to build.
    pause
    exit /b 1
)
if not exist "bin\flexpulse-provider.exe" (
    echo [x] Error: flexpulse-provider.exe failed to build.
    pause
    exit /b 1
)

echo [*] Binaries verified.
echo.

:: ---------------------------------------------------------------------
:: 3. Check Attached Hardware Devices
:: ---------------------------------------------------------------------
echo [2/3] Checking connected Android smartphones...
where adb >nul 2>nul
if %errorlevel% neq 0 (
    if exist ".tools\platform-tools\adb.exe" (
        set "PATH=%CD%\.tools\platform-tools;%PATH%"
    ) else if exist "C:\cln\smartphonetestfarm\.tools\platform-tools\adb.exe" (
        set "PATH=C:\cln\smartphonetestfarm\.tools\platform-tools;%PATH%"
    )
)

where adb >nul 2>nul
if %errorlevel% equ 0 (
    adb start-server >nul 2>&1
    echo.
    echo Connected Physical Devices:
    adb devices -l
    echo.
) else (
    echo [!] Warning: adb command not found on PATH.
)

:: ---------------------------------------------------------------------
:: 4. Start Services and Cloudflare Tunnel
:: ---------------------------------------------------------------------
echo [3/3] Starting Farm Services...
echo.

:: Kill any stale instances first
taskkill /F /IM flexpulse-coordinator.exe >nul 2>&1
taskkill /F /IM flexpulse-provider.exe >nul 2>&1

echo [*] Launching Coordinator Server (:9002)...
set COORDINATOR_POSTGRES_URI=postgresql://postgres.sqnkpkzjnypxhhwvnfob:6JWPgTz1VGmmNvco@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require
set COORDINATOR_SUPABASE_URL=https://sqnkpkzjnypxhhwvnfob.supabase.co
set COORDINATOR_GRPC_PORT=9000
set COORDINATOR_JWT_SECRET=protean-default-secret-key-change-me-123456
set COORDINATOR_STATIC_DIR=frontend\dist
set BYPASS_AUTH_IN_DEV=false
start "FlexPulse Coordinator (:9002)" bin\flexpulse-coordinator.exe

ping 127.0.0.1 -n 4 >nul

echo [*] Launching Device Provider (:9091)...
start "FlexPulse Provider (:9091)" bin\flexpulse-provider.exe --config config\provider.yaml --log-level info

ping 127.0.0.1 -n 3 >nul

echo.
echo ===================================================================
echo [SUCCESS] Local Services are running!
echo   - Coordinator API: http://localhost:9002/api/v1
echo   - Local Provider:  http://localhost:9091
echo ===================================================================
echo.
echo [*] Launching Cloudflare Quick Tunnel and syncing live URL to Supabase...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\cloudflare\run-quick-tunnel.ps1"

echo.
echo Farm stopped.
pause
