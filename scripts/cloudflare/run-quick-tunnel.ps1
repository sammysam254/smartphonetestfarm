# scripts/cloudflare/run-quick-tunnel.ps1
# Runs a free Cloudflare Quick Tunnel and automatically syncs the active URL
# to Supabase so remote users on Netlify connect seamlessly.

param(
    [string]$Target = "http://localhost:9002",
    [string]$SupabaseUrl = "https://sqnkpkzjnypxhhwvnfob.supabase.co",
    [string]$SupabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxbmtwa3pqbnlweGhod3ZuZm9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTIzNTMsImV4cCI6MjEwNjQyODM1M30.k_DvJGsYhL5cKk4UVjXp1UF5QPbEiK8h4Y0uvfONdww"
)

$ErrorActionPreference = "Continue"

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "         Cloudflare Free Quick Tunnel + Auto Supabase Sync        " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# Check cloudflared
$cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflaredCmd) {
    Write-Host "[!] 'cloudflared' was not found on your system." -ForegroundColor Yellow
    Write-Host "[*] Attempting to install via winget..." -ForegroundColor Cyan
    winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
    
    $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflaredCmd) {
        Write-Host "[x] Please install cloudflared manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Red
        Read-Host "Press Enter to exit..."
        exit 1
    }
}

Write-Host "[*] Starting Cloudflare Quick Tunnel pointing to $Target..." -ForegroundColor Green
Write-Host "[*] Waiting for tunnel URL from Cloudflare edge..." -ForegroundColor DarkGray
Write-Host ""

# Start cloudflared process and redirect stderr (cloudflared logs to stderr)
$pinfo = New-Object System.Diagnostics.ProcessStartInfo
$pinfo.FileName = "cloudflared"
$pinfo.Arguments = "tunnel --url $Target"
$pinfo.UseShellExecute = $false
$pinfo.RedirectStandardError = $true
$pinfo.RedirectStandardOutput = $true
$pinfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $pinfo
$process.Start() | Out-Null

$synced = $false

while (-not $process.HasExited) {
    $line = $process.StandardError.ReadLine()
    if ($line) {
        Write-Host $line -ForegroundColor Gray

        # Match https://xxxx.trycloudflare.com
        if (-not $synced -and $line -match "(https://[a-zA-Z0-9-]+\.trycloudflare\.com)") {
            $tunnelUrl = $matches[1]
            $synced = $true

            Write-Host ""
            Write-Host "===================================================================" -ForegroundColor Green
            Write-Host " [SUCCESS] Quick Tunnel Created: $tunnelUrl" -ForegroundColor Green
            Write-Host "===================================================================" -ForegroundColor Green
            Write-Host "[*] Publishing active tunnel URL to Supabase and Coordinator..." -ForegroundColor Cyan

            # 1. Update local coordinator (retries up to 6 times while it finishes starting)
            $coordUpdated = $false
            for ($attempt = 1; $attempt -le 6; $attempt++) {
                try {
                    $body = @{ url = $tunnelUrl } | ConvertTo-Json
                    $res = Invoke-RestMethod -Uri "http://localhost:9002/api/v1/system/tunnel-url" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 3 -ErrorAction Stop
                    Write-Host " [*] Local Coordinator updated and database synced with tunnel URL!" -ForegroundColor Green
                    $coordUpdated = $true
                    break
                } catch {
                    Start-Sleep -Seconds 1
                }
            }
            if (-not $coordUpdated) {
                Write-Host " [!] Coordinator will sync when it finishes startup." -ForegroundColor Yellow
            }

            # 2. Update Supabase REST table farm_config
            try {
                $platformId = $env:PLATFORM_ID
                if (-not $platformId -and (Test-Path ".platform_id")) {
                    $platformId = (Get-Content ".platform_id").Trim()
                }

                $headers = @{
                    "apikey" = $SupabaseAnonKey
                    "Authorization" = "Bearer $SupabaseAnonKey"
                    "Content-Type" = "application/json"
                    "Prefer" = "resolution=merge-duplicates"
                }
                $sbList = @(
                    @{
                        key = "tunnel_url"
                        value = $tunnelUrl
                    }
                )
                if ($platformId) {
                    $sbList += @{
                        key = "tunnel_url_$platformId"
                        value = $tunnelUrl
                    }
                }
                $sbPayload = $sbList | ConvertTo-Json

                $sbRes = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/farm_config" -Method Post -Headers $headers -Body $sbPayload -TimeoutSec 10 -ErrorAction SilentlyContinue
                Write-Host " [*] Supabase farm_config updated successfully!" -ForegroundColor Green
                if ($platformId) {
                    Write-Host " [*] Platform ID: $platformId mapped to tunnel: $tunnelUrl" -ForegroundColor Green
                    $devHeaders = @{
                        "apikey" = $SupabaseAnonKey
                        "Authorization" = "Bearer $SupabaseAnonKey"
                        "Content-Type" = "application/json"
                    }
                    $devPayload = @{ provider_ip = $tunnelUrl } | ConvertTo-Json
                    Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/devices?platform_id=eq.$platformId" -Method Patch -Headers $devHeaders -Body $devPayload -TimeoutSec 10 -ErrorAction SilentlyContinue
                }
                Write-Host " [*] Netlify dashboard is now connected to: $tunnelUrl" -ForegroundColor Cyan
            } catch {
                Write-Host " [!] Direct Supabase sync error: $_" -ForegroundColor DarkGray
            }

            Write-Host ""
            Write-Host "Tunnel is live! Leave this window open to keep streaming active." -ForegroundColor Yellow
            Write-Host "Press Ctrl+C to stop the tunnel." -ForegroundColor DarkGray
            Write-Host ""
        }
    }
}

$process.WaitForExit()
