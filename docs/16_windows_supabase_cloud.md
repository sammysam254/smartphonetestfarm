# Windows-Native Deployment with Supabase and Cloudflare Tunnel

This guide runs the entire device farm **natively on one Windows PC** — no Docker,
no WSL. Supabase provides the hosted Postgres database (and, optionally, user
authentication); a Cloudflare Tunnel publishes the dashboard and device streams
to the internet.

```
                       ┌──────────────── Cloudflare edge (HTTPS) ────────────────┐
Internet browser ────► │  farm.example.com  (WSS video, REST/WS API, SPA)        │
                       └───────────────────────────┬─────────────────────────────┘
                                                   │ Cloudflare Tunnel (cloudflared)
┌─ Your Windows PC ────────────────────────────────▼──────────────────────────────┐
│  coordinator.exe  :9002  ── serves frontend\dist + API + stream reverse-proxy  │
│       │              :9000  gRPC (provider registration/heartbeats/claims)     │
│       │                                                                        │
│       └── TLS ──► Supabase Postgres (session pooler) — devices, users, sessions│
│                                                                                │
│  provider.exe     :9091 gRPC (claims from coordinator)                         │
│                   :7400+ per-device stream servers (localhost only)            │
│       └──► adb.exe :5037 ──► Android device (scrcpy-server H.264)              │
└────────────────────────────────────────────────────────────────────────────────┘
```

Key idea: **the coordinator is the only public surface.** Browsers talk to it
for everything — UI, API, and the per-device video/control WebSockets, which
it reverse-proxies to the provider (`/api/v1/devices/{serial}/ws` →
`http://127.0.0.1:{stream_port}/ws`). Nothing on the PC needs to be exposed
except the tunnel.

---

## 1. Prerequisites

- Windows 10/11 PC with the Android device(s) attached over USB
- [Node.js 20+](https://nodejs.org) (frontend build)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (only for internet access)
- A [Supabase](https://supabase.com) account (free tier works)
- Go 1.26+, adb, and scrcpy-server are installed automatically by the setup script

Enable **USB debugging** on each device (Settings → Developer options) and
accept the RSA fingerprint dialog when first plugged in.

## 2. Supabase project

1. Create a project. Note the **database password** you choose.
2. **Connection string**: Dashboard → **Connect** → **Connection pooling** →
   **Session pooler**. Use that URI (IPv4-friendly; the direct connection is
   IPv6-only). Keep `?sslmode=require` and **remove `pgbouncer=true`** if
   present — `lib/pq` rejects unknown parameters. URL-encode special
   characters in the password (e.g. `@` → `%40`).
3. **Schema**: nothing to do — the coordinator creates all tables on first
   start (`internal/db/db.go` migrations run automatically).
4. **Hardening** *(important)*: after the coordinator's first successful
   start, run `scripts/supabase-hardening.sql` in the Supabase SQL Editor.
   It revokes Supabase's auto-generated REST (PostgREST) access to the farm
   tables — otherwise anyone holding the anon key can read password hashes.
5. Free-tier note: idle Supabase projects pause after ~a week; restore the
   project from the dashboard if the coordinator reports connection errors.

## 3. Supabase Auth (optional but recommended)

Two ways to authenticate:

| Mode | Frontend `.env` | Coordinator | Who can log in |
|---|---|---|---|
| Local (default) | both values empty | no JWKS URL | accounts in the farm DB (seeded `admin@domain.com` / `Welcome@2026`) |
| Supabase Auth | URL + anon key set | project URL (derives JWKS) or explicit `COORDINATOR_OIDC_JWKS_URL` | users created in Supabase → Authentication → Users |

To enable Supabase Auth:

1. In Supabase: Dashboard → **Authentication** → **Sign In / Up** → enable the
   Email provider. Create at least one user.
2. Supabase must issue **asymmetric (RS256) JWTs**: Dashboard →
   **Authentication** → **Signing keys** (or API Keys → JWT Settings) →
   generate/enable the **JWKS** endpoint. Copy the JWKS URL
   (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`).
3. Coordinator env: pass the project URL as `-SupabaseUrl https://<ref>.supabase.co`
   and the script derives the canonical JWKS endpoint automatically;
   alternatively set `COORDINATOR_OIDC_JWKS_URL` / `-JwksUrl` explicitly.
4. Frontend: copy `frontend/.env.example` → `frontend/.env`, fill
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, rebuild
   (`npm run build` in `frontend/`).

How it works: the login screen calls Supabase directly; the browser then sends
Supabase's session JWT as a Bearer token; the coordinator verifies it against
JWKS and maps `sub`/`email` to a local user row on first login
(`internal/auth/auth_service.go` → `ResolveOIDCUser`). **The first Supabase
login on an empty users table becomes the farm admin**; subsequent users are
regular users in the `Public` group. A Supabase account whose email matches an
existing local account (e.g. the seeded admin) adopts that account's role.

## 4. Build and run

```powershell
# One-time (installs Go + adb, downloads scrcpy-server, builds everything):
powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1

# Terminal 1 — coordinator (prompts for the Supabase URI on first run):
powershell -ExecutionPolicy Bypass -File scripts\windows\run-coordinator.ps1 `
    -SupabaseUri "postgres://postgres.xxx:PASS@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require" `
    -SupabaseUrl "https://<ref>.supabase.co"   # omit both *_Url flags for local login

# Terminal 2 — provider (plug in the device first):
powershell -ExecutionPolicy Bypass -File scripts\windows\run-provider.ps1
```

Open **http://localhost:9002**, log in, and the device appears within seconds.
Click it to claim — this pushes scrcpy-server to the phone and starts the
H.264 stream. Touch/keyboard input on the canvas controls the device.

Startup order matters: coordinator first (it owns the database), then the
provider (it registers itself over gRPC on `:9000`).

## 5. Cloudflare Tunnel (internet access)

One-time setup:

```powershell
cloudflared tunnel login
cloudflared tunnel create protean-farm
cloudflared tunnel route dns protean-farm farm.example.com   # your zone's hostname
# Edit scripts\cloudflare\config.yml → tunnel UUID + credentials-file path
```

Then, with coordinator + provider running:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\cloudflare\run-tunnel.ps1
```

The dashboard is now live at `https://farm.example.com`, including video:
the tunnel terminates TLS (satisfying WebCodecs' secure-context requirement
on remote browsers) and forwards everything to the coordinator on
`localhost:9002`, which reverse-proxies device streams to the provider.

Recommended Cloudflare dashboard settings for smooth streaming:
- **Network → WebSockets**: enabled (default)
- **Speed → Optimization → Protocol Optimization**: keep gRPC/Brotli defaults;
  the video path is binary-over-WebSocket and needs no transformation
- Cloudflare proxy timeouts (~100 s idle) can close a paused video WS; the
  frontend reconnects automatically, but keep sessions active while debugging

## 6. Ports & processes (single-PC layout)

| Port | Process | Binding |
|---|---|---|
| 9000 | coordinator gRPC | localhost (provider ↔ coordinator) |
| 9002 | coordinator HTTP: UI + API + stream proxy | localhost (tunnel ingress) |
| 9091 | provider inbound gRPC | localhost (coordinator claims) |
| 7400–7700 | per-device stream servers | localhost (coordinator proxies) |
| 5037 | adb daemon | localhost |

`config/provider.yaml` pins `provider.ip: "127.0.0.1"` — leave it that way
unless you add provider hardware on other machines, in which case set it to
that host's LAN IP and open 9091 + the stream port range to the coordinator
host only.

## 7. Troubleshooting

- **`postgres ping: ...` on coordinator start** — URI wrong or project paused.
  Use the *session pooler* URI; remove `pgbouncer=true`; URL-encode the password.
- **Device shows but video is black** — check provider console for
  `stream: start scrcpy-server` errors; confirm `adb devices` lists the device
  as `device` (not `unauthorized`); Windows Defender Firewall may prompt on
  first run — allow the provider on private networks.
- **Login fails with Supabase enabled** — verify the JWKS URL returns JSON
  keys, and that the user exists in Supabase → Authentication → Users. The
  coordinator log shows `auth: failed to resolve external identity` on mapping
  errors.
- **Remote browser: no video, UI loads** — open the browser devtools console;
  a WebCodecs secure-context error means the page was loaded over plain HTTP
  (use the tunnel hostname). Also confirm the tunnel is running.
- **`adb` not recognized in a new terminal** — the setup script adds
  `.tools\platform-tools` to the *user* PATH; restart the terminal.

## 8. Related files

| Concern | Where |
|---|---|
| Stream reverse-proxy | `internal/coordinator_server/proxy.go` |
| SPA hosting | `internal/coordinator_server/static.go` |
| Supabase JWT verification (JWKS n/e) | `internal/auth/jwt.go` |
| OIDC user provisioning | `internal/auth/auth_service.go`, `internal/auth/middleware.go` |
| Frontend config / Supabase client | `frontend/src/lib/config.js`, `frontend/src/lib/supabase.js` |
| Setup / run scripts | `scripts/windows/`, `scripts/cloudflare/` |
| DB hardening | `scripts/supabase-hardening.sql` |
