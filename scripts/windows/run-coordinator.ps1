# scripts/windows/run-coordinator.ps1
# Runs the coordinator natively on Windows with Supabase as the database and
# (optionally) Supabase Auth. Serves the built dashboard on http://localhost:9002.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\run-coordinator.ps1
#
# Or with explicit arguments:
#   powershell ... -SupabaseUri "postgres://..." -SupabaseUrl "https://xyz.supabase.co" ...
#
# Values can also come from environment variables (COORDINATOR_POSTGRES_URI etc.);
# arguments win over environment variables, which win over the interactive prompt.

param(
    # Supabase -> Dashboard -> Connect -> Connection pooling -> Session pooler URI.
    # Use the pooler (IPv4-friendly). Keep sslmode=require and REMOVE the
    # "pgbouncer=true" parameter if Supabase included it - lib/pq rejects it.
    [string]$SupabaseUri = $env:COORDINATOR_POSTGRES_URI,

    # Supabase project URL (https://<ref>.supabase.co). When provided (and no
    # explicit JWKS URL), the standard JWKS endpoint is derived from it:
    #   <SupabaseUrl>/auth/v1/.well-known/jwks.json
    [string]$SupabaseUrl = $env:COORDINATOR_SUPABASE_URL,

    # Supabase -> Dashboard -> Authentication -> API Keys/Signing: JWKS URL.
    # Only needed when using Supabase Auth (asymmetric JWT keys). Takes
    # precedence over -SupabaseUrl derivation when both are given.
    [string]$JwksUrl = $env:COORDINATOR_OIDC_JWKS_URL,

    [string]$JwtSecret = $env:COORDINATOR_JWT_SECRET,
    [int]$GrpcPort = 9000
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$binary = "$root\bin\flexpulse-coordinator.exe"

if (-not (Test-Path $binary)) {
    throw "flexpulse-coordinator.exe not found - run scripts\windows\setup.ps1 first."
}

if (-not $SupabaseUri) {
    $SupabaseUri = Read-Host @"
Supabase Postgres URI not set.
Get it from: Supabase Dashboard -> Connect -> Connection pooling -> Session pooler
Example: postgres://postgres.abcdefghijklm:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
URI
"@.Trim()
}
if ($SupabaseUri -match "pgbouncer=true&?") {
    $SupabaseUri = $SupabaseUri -replace "pgbouncer=true&?", ""
    Write-Host "Removed unsupported 'pgbouncer=true' parameter from URI." -ForegroundColor Yellow
}

if (-not $JwtSecret) { $JwtSecret = "protean-default-secret-key-change-me-123456" }

if (-not $JwksUrl -and $SupabaseUrl) {
    # Derive the canonical Supabase JWKS endpoint from the project URL so the
    # only Auth value needed alongside the anon key is the project URL itself.
    $JwksUrl = $SupabaseUrl.TrimEnd('/') + "/auth/v1/.well-known/jwks.json"
    Write-Host "Derived JWKS URL from Supabase project URL: $JwksUrl" -ForegroundColor DarkGray
}

$env:COORDINATOR_POSTGRES_URI = $SupabaseUri
$env:COORDINATOR_GRPC_PORT = "$GrpcPort"
$env:COORDINATOR_JWT_SECRET = $JwtSecret
$env:BYPASS_AUTH_IN_DEV = "false"

if ($JwksUrl) {
    # Supabase Auth mode: the coordinator verifies session JWTs against JWKS.
    $env:COORDINATOR_OIDC_JWKS_URL = $JwksUrl
    Write-Host "Auth: Supabase JWTs (RS256 via JWKS)" -ForegroundColor Cyan
} else {
    Write-Host "Auth: local password login (no JWKS configured)" -ForegroundColor Cyan
}

# Serve the built dashboard from the same origin as the API - required for
# the Cloudflare Tunnel setup (single ingress) and nice for local use too.
$dist = "$root\frontend\dist"
if (Test-Path "$dist\index.html") {
    $env:COORDINATOR_STATIC_DIR = $dist
} else {
    Write-Host "frontend\dist not found - dashboard will not be served (run setup.ps1)." -ForegroundColor Yellow
}

Write-Host "`nStarting coordinator (API+UI on :$($GrpcPort + 2), gRPC on :$GrpcPort)...`n" -ForegroundColor Green
& $binary
