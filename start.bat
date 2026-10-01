@echo off
setlocal enabledelayedexpansion
title FlexPulse Farm Launcher
cd /d "%~dp0"

echo ===================================================================
echo               FlexPulse Mobile Device Farm Host
echo ===================================================================
echo.

:: ---------------------------------------------------------------------
:: 1. Pull latest updates from GitHub
:: ---------------------------------------------------------------------
where git >nul 2>nul
if %errorlevel% equ 0 (
    if exist ".git" (
        echo [1/4] Checking for GitHub repository updates...
        git pull --rebase
        if !errorlevel! neq 0 (
            echo [!] Git pull reported issues or merge conflict. Continuing with local version...
        ) else (
            echo [*] Repository is up to date.
        )
    ) else (
        echo [1/4] Not a git clone directory. Skipping git pull.
    )
) else (
    echo [1/4] Git not found on PATH. Skipping git pull.
)
echo.

:: ---------------------------------------------------------------------
:: 2. Check Dependencies & Binaries
:: ---------------------------------------------------------------------
echo [2/4] Verifying dependencies and binaries...
set NEED_SETUP=0

if not exist "bin\flexpulse-coordinator.exe" set NEED_SETUP=1
if not exist "bin\flexpulse-provider.exe" set NEED_SETUP=1
if not exist "internal\stream\scrcpy-server.jar" set NEED_SETUP=1

where go >nul 2>nul
if %errorlevel% neq 0 set NEED_SETUP=1

where node >nul 2>nul
if %errorlevel% neq 0 set NEED_SETUP=1

where git >nul 2>nul
if %errorlevel% neq 0 set NEED_SETUP=1

where cloudflared >nul 2>nul
if %errorlevel% neq 0 set NEED_SETUP=1

where adb >nul 2>nul
if %errorlevel% neq 0 (
    if not exist ".tools\platform-tools\adb.exe" set NEED_SETUP=1
)

if %NEED_SETUP% equ 1 (
    echo [!] Missing binaries or dependencies detected.
    echo [*] Running automated setup (installing Go/adb, building binaries, building frontend)...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\setup.ps1"
    if !errorlevel! neq 0 (
        echo.
        echo [x] Setup encountered an error. Please resolve the issue above.
        pause
        exit /b 1
    )
) else (
    echo [*] Core dependencies and binaries verified.
)
echo.

:: ---------------------------------------------------------------------
:: 3. Supabase Credentials (Pre-configured)
:: ---------------------------------------------------------------------
echo [3/4] Supabase configuration loaded:
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        set "line_key=%%a"
        if not "!line_key:~0,1!"=="#" (
            set "%%a=%%b"
        )
    )
)

if "%COORDINATOR_POSTGRES_URI%"=="" (
    set "COORDINATOR_POSTGRES_URI=postgresql://postgres:6JWPgTz1VGmmNvco@db.sqnkpkzjnypxhhwvnfob.supabase.co:5432/postgres?sslmode=require"
)
if "%COORDINATOR_SUPABASE_URL%"=="" (
    set "COORDINATOR_SUPABASE_URL=https://sqnkpkzjnypxhhwvnfob.supabase.co"
)

echo   DB Host: db.sqnkpkzjnypxhhwvnfob.supabase.co
echo   Project: https://sqnkpkzjnypxhhwvnfob.supabase.co
echo.

:: ---------------------------------------------------------------------
:: 4. Check ADB Devices & Launch Farm Services
:: ---------------------------------------------------------------------
echo [4/4] Checking attached devices and starting services...

:: Ensure adb path is available in current shell
if exist ".tools\platform-tools\adb.exe" (
    set "PATH=%CD%\.tools\platform-tools;%PATH%"
)

where adb >nul 2>nul
if %errorlevel% equ 0 (
    adb start-server >nul 2>&1
    echo.
    echo Connected Physical Devices:
    adb devices -l
    echo.
)

echo [*] Starting Coordinator Server (:9002)...
start "FlexPulse Coordinator (:9002)" powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\run-coordinator.ps1" -SupabaseUri "%COORDINATOR_POSTGRES_URI%" -SupabaseUrl "%COORDINATOR_SUPABASE_URL%"

timeout /t 3 /nobreak >nul

echo [*] Starting Provider Daemon (:9091)...
start "FlexPulse Provider (:9091)" powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\run-provider.ps1"

timeout /t 2 /nobreak >nul

echo.
echo ===================================================================
echo [SUCCESS] Local Services Started!
echo   Coordinator API:   http://localhost:9002/api/v1
echo   Provider Port:     9091
echo ===================================================================
echo.
echo [*] Launching Cloudflare Quick Tunnel and syncing live URL to Supabase...
echo.

:: Automatically run Cloudflare Quick Tunnel and sync to Supabase
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\cloudflare\run-quick-tunnel.ps1"

