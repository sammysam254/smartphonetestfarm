# scripts/windows/setup.ps1
# One-time setup for running the Protean device farm natively on Windows.
#
# Installs/verifies:  Go toolchain, Android platform-tools (adb), scrcpy-server,
#                     coordinator.exe + provider.exe, and the frontend build.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
#
# Re-running is safe: every step is idempotent.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# -- 1. Go toolchain -----
Write-Step "Checking Go toolchain"
$go = Get-Command go -ErrorAction SilentlyContinue
if (-not $go) {
    # Not on PATH yet - maybe winget just installed it.
    $goPath = "C:\Program Files\Go\bin\go.exe"
    if (Test-Path $goPath) {
        $env:PATH = "C:\Program Files\Go\bin;$env:PATH"
    } else {
        Write-Host "Go not found - installing with winget (GoLang.Go)..."
        winget install --id GoLang.Go --silent --accept-package-agreements --accept-source-agreements
        if (Test-Path $goPath) {
            $env:PATH = "C:\Program Files\Go\bin;$env:PATH"
        } else {
            throw "Go installation failed. Install Go 1.26+ manually from https://go.dev/dl/ and re-run."
        }
    }
}
& go version

# -- 2. Android platform-tools (adb) -----
Write-Step "Checking adb (Android platform-tools)"
$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    $localAdb = "$root\.tools\platform-tools\adb.exe"
    if (-not (Test-Path $localAdb)) {
        Write-Host "Downloading platform-tools..."
        New-Item -ItemType Directory -Force -Path "$root\.tools" | Out-Null
        $zip = "$root\.tools\platform-tools.zip"
        curl.exe -fsSL -o $zip https://dl.google.com/android/repository/platform-tools-latest-windows.zip
        Expand-Archive -Path $zip -DestinationPath "$root\.tools" -Force
        Remove-Item $zip
    }
    $env:PATH = "$root\.tools\platform-tools;$env:PATH"
    # Persist for future shells (best effort; user-level, no admin needed).
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*\.tools\platform-tools*") {
        [Environment]::SetEnvironmentVariable("PATH", "$userPath;$root\.tools\platform-tools", "User")
        Write-Host "Added platform-tools to your user PATH (new terminals only)."
    }
}
& adb version | Select-Object -First 1

# -- 3. scrcpy-server (embedded at build time) -----
Write-Step "Checking scrcpy-server.jar (embedded into provider.exe)"
$scrcpy = "$root\internal\stream\scrcpy-server.jar"
if (-not (Test-Path $scrcpy)) {
    Write-Host "Downloading scrcpy-server v4.0..."
    curl.exe -fsSL -o $scrcpy https://github.com/Genymobile/scrcpy/releases/download/v4.0/scrcpy-server-v4.0
}
Write-Host ("scrcpy-server.jar: {0:N0} bytes" -f (Get-Item $scrcpy).Length)

# -- 4. Build backend binaries -----
Write-Step "Building flexpulse-coordinator.exe and flexpulse-provider.exe"
New-Item -ItemType Directory -Force -Path "$root\bin" | Out-Null
& go build -buildvcs=false -ldflags "-s -w" -o "$root\bin\flexpulse-coordinator.exe" ".\cmd\coordinator"
if ($LASTEXITCODE -ne 0) { throw "coordinator build failed" }
& go build -buildvcs=false -ldflags "-s -w" -o "$root\bin\flexpulse-provider.exe" ".\cmd\provider"
if ($LASTEXITCODE -ne 0) { throw "provider build failed" }
Write-Host "Built bin\flexpulse-coordinator.exe and bin\flexpulse-provider.exe"

# -- 5. Frontend build -----
Write-Step "Building frontend (frontend\dist)"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js not found. Install Node 20+ from https://nodejs.org and re-run." }
Push-Location "$root\frontend"
try {
    if (-not (Test-Path "node_modules")) { npm install }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally {
    Pop-Location
}

Write-Host @"

Setup complete. Next steps:

  1. start.bat   (or scripts\windows\run-coordinator.ps1 + run-provider.ps1)
  2. Plug in an Android device with USB debugging enabled.
  3. Open http://localhost:9002 - or your Cloudflare Tunnel hostname.
     See docs\16_windows_supabase_cloud.md for the full walkthrough.

"@ -ForegroundColor Green
