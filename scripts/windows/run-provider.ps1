# scripts/windows/run-provider.ps1
# Runs the provider natively on Windows. Start AFTER the coordinator, with an
# Android device plugged in and USB debugging authorized.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\run-provider.ps1

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$binary = "$root\bin\flexpulse-provider.exe"

if (-not (Test-Path $binary)) {
    throw "flexpulse-provider.exe not found - run scripts\windows\setup.ps1 first."
}

# adb must be on PATH for scrcpy-server push + port forwarding. setup.ps1
# downloads it to .tools\platform-tools and registers it on the user PATH;
# this covers shells opened before that.
$localTools = "$root\.tools\platform-tools"
if (-not (Get-Command adb -ErrorAction SilentlyContinue) -and (Test-Path "$localTools\adb.exe")) {
    $env:PATH = "$localTools;$env:PATH"
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb not found - run scripts\windows\setup.ps1 first."
}

# Make sure the ADB daemon is up and show what's connected.
& adb start-server
Write-Host "`nConnected devices:" -ForegroundColor Cyan
& adb devices -l
Write-Host ""

Write-Host "Starting FlexPulse provider (gRPC :9091, stream ports 7400-7700)..." -ForegroundColor Green
& $binary --config "$root\config\provider.yaml" --log-level debug
