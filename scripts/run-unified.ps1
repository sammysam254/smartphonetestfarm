# scripts/run-unified.ps1
# Unified FlexPulse Farm Runner
# Runs Coordinator, Provider, and Cloudflare Tunnel concurrently in ONE single console window
# with live interleaved log streaming and automatic Supabase cloud synchronization.

param(
    [string]$Target = "http://localhost:9002",
    [string]$SupabaseUrl = "https://sqnkpkzjnypxhhwvnfob.supabase.co",
    [string]$SupabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxbmtwa3pqbnlweGhod3ZuZm9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTIzNTMsImV4cCI6MjEwNjQyODM1M30.k_DvJGsYhL5cKk4UVjXp1UF5QPbEiK8h4Y0uvfONdww",
    [string]$PostgresUri = "postgresql://postgres.sqnkpkzjnypxhhwvnfob:6JWPgTz1VGmmNvco@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
)

$ErrorActionPreference = "Continue"

# 1. Resolve Workspace Root
$WorkspaceRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $WorkspaceRoot

# 2. Kill any stale processes first
Get-Process flexpulse-coordinator -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process flexpulse-provider -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 3. Persistent SaaS Platform ID
$platformIdFile = Join-Path $WorkspaceRoot ".platform_id"
if (-not (Test-Path $platformIdFile)) {
    $platformId = "FP-HOST-" + [guid]::NewGuid().Guid.Substring(0,8).ToUpper()
    Set-Content -Path $platformIdFile -Value $platformId -Encoding ascii -NoNewline
} else {
    $platformId = (Get-Content $platformIdFile).Trim()
}

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "              FlexPulse Mobile Device Farm Host                    " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "  YOUR PERSISTENT PLATFORM ID:  $platformId" -ForegroundColor Yellow
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "  Enter this Platform ID on the Web Dashboard:" -ForegroundColor Gray
Write-Host "  https://vertextstreams.netlify.app" -ForegroundColor White
Write-Host "  to link and verify this computer's devices!" -ForegroundColor Gray
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# 4. Check ADB toolchain & attached smartphones
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adbCmd) {
    $toolsAdb = Join-Path $WorkspaceRoot ".tools\platform-tools\adb.exe"
    if (Test-Path $toolsAdb) {
        $env:PATH = (Split-Path $toolsAdb) + ";" + $env:PATH
    }
}
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if ($adbCmd) {
    & adb start-server 2>&1 | Out-Null
    Write-Host "[*] Connected Physical Smartphones:" -ForegroundColor Green
    & adb devices -l | Out-String | Write-Host -ForegroundColor Gray
} else {
    Write-Host "[!] Warning: 'adb' tool was not found on PATH." -ForegroundColor Yellow
}

# 5. Check Cloudflared
$cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflaredCmd) {
    Write-Host "[!] 'cloudflared' not found. Installing via winget..." -ForegroundColor Yellow
    winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
    $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
}

# 6. Set Environment Variables for Farm Coordinator
$env:COORDINATOR_POSTGRES_URI = $PostgresUri
$env:COORDINATOR_SUPABASE_URL = $SupabaseUrl
$env:COORDINATOR_GRPC_PORT = "9000"
$env:COORDINATOR_JWT_SECRET = "protean-default-secret-key-change-me-123456"
$env:COORDINATOR_STATIC_DIR = Join-Path $WorkspaceRoot "frontend\dist"
$env:BYPASS_AUTH_IN_DEV = "true"
$env:PLATFORM_ID = $platformId

Write-Host "[*] Starting Coordinator and Provider in ONE single console..." -ForegroundColor Cyan
Write-Host "[*] Live logs from all services will appear below." -ForegroundColor DarkGray
Write-Host ""

$coordExe = Join-Path $WorkspaceRoot "bin\flexpulse-coordinator.exe"
$provExe = Join-Path $WorkspaceRoot "bin\flexpulse-provider.exe"
$provConfig = Join-Path $WorkspaceRoot "config\provider.yaml"

if (-not (Test-Path $coordExe)) {
    Write-Host "[x] Error: Coordinator binary missing at $coordExe" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $provExe)) {
    Write-Host "[x] Error: Provider binary missing at $provExe" -ForegroundColor Red
    exit 1
}

# Launch Coordinator first in current console window
$coordProc = Start-Process -FilePath $coordExe -WorkingDirectory $WorkspaceRoot -NoNewWindow -PassThru

# Wait for Coordinator to establish database migrations and listen on gRPC :9000
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 9000)
        $tcp.Close()
        break
    } catch {}
}

# Launch Provider in current console window (connects immediately with zero backoff)
$provProc = Start-Process -FilePath $provExe -ArgumentList "--config `"$provConfig`" --log-level info" -WorkingDirectory $WorkspaceRoot -NoNewWindow -PassThru

$script:synced = $false

try {
    if ($cloudflaredCmd) {
        Write-Host "[*] Connecting Cloudflare Quick Tunnel..." -ForegroundColor Cyan
        & cloudflared tunnel --url $Target 2>&1 | ForEach-Object {
            $line = $_.ToString()
            if (-not $script:synced -and $line -match "(https://[a-zA-Z0-9-]+\.trycloudflare\.com)") {
                $script:synced = $true
                $tunnelUrl = $matches[1]

                Write-Host ""
                Write-Host "===================================================================" -ForegroundColor Green
                Write-Host " [SUCCESS] Cloudflare Quick Tunnel Live: $tunnelUrl" -ForegroundColor Green
                Write-Host "===================================================================" -ForegroundColor Green
                Write-Host " [*] Syncing active tunnel URL to Supabase and Coordinator..." -ForegroundColor Cyan

                # Sync to local coordinator
                try {
                    $body = @{ url = $tunnelUrl } | ConvertTo-Json
                    Invoke-RestMethod -Uri "http://localhost:9002/api/v1/system/tunnel-url" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
                } catch {}

                # Sync to Supabase farm_config
                try {
                    $headers = @{
                        "apikey" = $SupabaseAnonKey
                        "Authorization" = "Bearer $SupabaseAnonKey"
                        "Content-Type" = "application/json"
                        "Prefer" = "resolution=merge-duplicates"
                    }
                    $sbList = @(
                        @{ key = "tunnel_url"; value = $tunnelUrl },
                        @{ key = "tunnel_url_$platformId"; value = $tunnelUrl }
                    )
                    $sbPayload = $sbList | ConvertTo-Json
                    Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/farm_config" -Method Post -Headers $headers -Body $sbPayload -TimeoutSec 10 -ErrorAction SilentlyContinue | Out-Null

                    # Also patch devices with this platform_id
                    $devPayload = @{ provider_ip = $tunnelUrl } | ConvertTo-Json
                    Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/devices?platform_id=eq.$platformId" -Method Patch -Headers $headers -Body $devPayload -TimeoutSec 10 -ErrorAction SilentlyContinue | Out-Null
                } catch {}

                Write-Host " [*] Netlify dashboard is now connected: https://vertextstreams.netlify.app" -ForegroundColor Green
                Write-Host " [*] Platform ID: $platformId" -ForegroundColor Yellow
                Write-Host "===================================================================" -ForegroundColor Green
                Write-Host ""
            }
            Write-Host $line -ForegroundColor DarkGray
        }
    } else {
        while (-not $coordProc.HasExited -and -not $provProc.HasExited) {
            Start-Sleep -Seconds 1
        }
    }
} finally {
    Write-Host ""
    Write-Host "[*] Stopping farm services..." -ForegroundColor Yellow
    if ($coordProc -and -not $coordProc.HasExited) { Stop-Process -Id $coordProc.Id -Force -ErrorAction SilentlyContinue }
    if ($provProc -and -not $provProc.HasExited) { Stop-Process -Id $provProc.Id -Force -ErrorAction SilentlyContinue }
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[*] Farm stopped cleanly." -ForegroundColor Gray
}
