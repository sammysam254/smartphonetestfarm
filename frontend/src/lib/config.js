// Central runtime configuration shared by every component.
//
// Where is the coordinator?
//   - Production / Cloudflare Tunnel: the dashboard is served by the
//     coordinator itself (or tunnelled to it), so the API is same-origin.
//   - Vite dev server (port 5173): fall back to the coordinator on port 9002.
//   - VITE_COORDINATOR_API always wins if set.

const storedApi = typeof window !== 'undefined' ? localStorage.getItem('coordinator_api') : null;
const explicitApi = storedApi || import.meta.env.VITE_COORDINATOR_API;

const isViteDev = import.meta.env.DEV === true;

export function getCoordinatorApi() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('coordinator_api');
    if (stored && stored.trim()) return stored.trim().replace(/\/+$/, '');
  }
  if (import.meta.env.VITE_COORDINATOR_API) {
    return import.meta.env.VITE_COORDINATOR_API.trim().replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:9002`;
  }
  // When running on Netlify / remote static host without a tunnel configured:
  if (typeof window !== 'undefined' && (window.location.hostname.includes('netlify.app') || window.location.hostname.includes('vercel.app'))) {
    return '';
  }
  return `${window.location.protocol}//${window.location.host}`;
}

export let COORDINATOR_API = getCoordinatorApi();

export function updateCoordinatorApi(newUrl) {
  if (!newUrl) return;
  const clean = newUrl.trim().replace(/\/+$/, '');
  COORDINATOR_API = clean;
  if (typeof window !== 'undefined') {
    localStorage.setItem('coordinator_api', clean);
  }
}

// Hardcoded Supabase Configuration
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://sqnkpkzjnypxhhwvnfob.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxbmtwa3pqbnlweGhod3ZuZm9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTIzNTMsImV4cCI6MjEwNjQyODM1M30.k_DvJGsYhL5cKk4UVjXp1UF5QPbEiK8h4Y0uvfONdww';

export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// URL of a device stream endpoint on the coordinator. The coordinator
// reverse-proxies these to the provider's per-device stream server, so remote
// (tunnelled) browsers never need direct access to provider stream ports.
// subpath: 'ws' | 'stream' | 'state' | 'upload'
export const deviceApiUrl = (serial, subpath) => {
  const base = getCoordinatorApi() || window.location.origin;
  return `${base}/api/v1/devices/${encodeURIComponent(serial)}/${subpath}`;
};

// WebSocket URL for the device video/control channel (same-origin friendly:
// https → wss). The auth token rides along as a query param because
// WebSocket APIs cannot set Authorization headers.
export const streamWSUrl = (serial, token) => {
  const url = new URL(deviceApiUrl(serial, 'ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  return url.toString();
};

export function getStoredCoordinatorApi() {
  return typeof window !== 'undefined' ? localStorage.getItem('coordinator_api') || '' : '';
}

export function setStoredCoordinatorApi(url) {
  if (typeof window === 'undefined') return;
  if (!url || !url.trim()) {
    localStorage.removeItem('coordinator_api');
  } else {
    localStorage.setItem('coordinator_api', url.trim().replace(/\/+$/, ''));
  }
}

