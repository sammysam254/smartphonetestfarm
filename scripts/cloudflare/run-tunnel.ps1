# scripts/cloudflare/run-tunnel.ps1
# Starts the Cloudflare Tunnel pointing at the local coordinator (:9002).
#
# Prerequisites (one-time, see config.yml header for details):
#   cloudflared tunnel login
#   cloudflared tunnel create protean-farm
#   cloudflared tunnel route dns protean-farm <your-hostname>
#   -> then edit scripts\cloudflare\config.yml with the tunnel UUID.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\cloudflare\run-tunnel.ps1

$ErrorActionPreference = "Stop"

$cfg = "$PSScriptRoot\config.yml"
if (-not (Test-Path $cfg)) { throw "config.yml not found next to this script." }

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw "cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and re-run."
}

# Fail fast on unedited placeholder config.
if ((Get-Content $cfg -Raw) -match "REPLACE_WITH_YOUR_TUNNEL_UUID") {
    throw "config.yml still contains placeholder values - fill in your tunnel UUID and credentials file path."
}

Write-Host "Starting Cloudflare Tunnel (coordinator on http://localhost:9002)..." -ForegroundColor Green
& cloudflared tunnel --config $cfg run
