@echo off
setlocal enabledelayedexpansion
title FlexPulse Mobile Device Farm
cd /d "%~dp0"

:: ---------------------------------------------------------------------
:: 1. Ensure we are in the FlexPulse repository directory
:: ---------------------------------------------------------------------
if not exist "go.mod" (
    if exist "C:\smartphone\smartphonetestfarm\go.mod" (
        cd /d "C:\smartphone\smartphonetestfarm"
    ) else if exist "%USERPROFILE%\smartphonetestfarm\go.mod" (
        cd /d "%USERPROFILE%\smartphonetestfarm"
    ) else if exist "smartphonetestfarm\go.mod" (
        cd /d "smartphonetestfarm"
    ) else (
        echo [*] Workspace not detected. Cloning FlexPulse repository...
        where git >nul 2>nul
        if %errorlevel% equ 0 (
            git clone https://github.com/sammysam254/smartphonetestfarm.git
            if exist "smartphonetestfarm\go.mod" cd /d "smartphonetestfarm"
        )
    )
)

:: ---------------------------------------------------------------------
:: 2. Verify Precompiled Binaries
:: ---------------------------------------------------------------------
if not exist "bin\flexpulse-coordinator.exe" (
    where go >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Compiling coordinator...
        go build -buildvcs=false -ldflags "-s -w" -o bin\flexpulse-coordinator.exe .\cmd\coordinator
    )
)
if not exist "bin\flexpulse-provider.exe" (
    where go >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Compiling provider...
        go build -buildvcs=false -ldflags "-s -w" -o bin\flexpulse-provider.exe .\cmd\provider
    )
)

if not exist "bin\flexpulse-coordinator.exe" (
    echo [x] Error: bin\flexpulse-coordinator.exe was not found.
    pause
    exit /b 1
)
if not exist "bin\flexpulse-provider.exe" (
    echo [x] Error: bin\flexpulse-provider.exe was not found.
    pause
    exit /b 1
)

:: ---------------------------------------------------------------------
:: 3. Run All Services in ONE Single Shell
:: ---------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-unified.ps1"

echo.
echo FlexPulse Farm stopped.
pause
