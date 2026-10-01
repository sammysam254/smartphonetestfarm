// Central runtime configuration shared by every component.
//
// Where is the coordinator?
//   - Production / Cloudflare Tunnel: the dashboard is served by the
//     coordinator itself (or tunnelled to it), so the API is same-origin.
//   - Vite dev server (port 5173): fall back to the coordinator on port 9002.
//   - VITE_COORDINATOR_API always wins if set.

const explicitApi = import.meta.env.VITE_COORDINATOR_API;

const isViteDev = import.meta.env.DEV === true;

export const COORDINATOR_API =
  explicitApi ||
  (isViteDev
    ? `${window.location.protocol}//${window.location.hostname}:9002`
    : `${window.location.protocol}//${window.location.host}`);

// Supabase Auth (optional). When both values are present the login screen
// authenticates against Supabase and the app uses Supabase session JWTs;
// otherwise it falls back to the coordinator's local password login.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// URL of a device stream endpoint on the coordinator. The coordinator
// reverse-proxies these to the provider's per-device stream server, so remote
// (tunnelled) browsers never need direct access to provider stream ports.
// subpath: 'ws' | 'stream' | 'state' | 'upload'
export const deviceApiUrl = (serial, subpath) =>
  `${COORDINATOR_API}/api/v1/devices/${encodeURIComponent(serial)}/${subpath}`;

// WebSocket URL for the device video/control channel (same-origin friendly:
// https → wss). The auth token rides along as a query param because
// WebSocket APIs cannot set Authorization headers.
export const streamWSUrl = (serial, token) => {
  const url = new URL(deviceApiUrl(serial, 'ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  return url.toString();
};
