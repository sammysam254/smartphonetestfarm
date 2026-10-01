// Lazy Supabase client singleton.
//
// The client is only created when the Supabase env vars are configured, so
// the rest of the app can call getSupabase() unconditionally and null-check.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ENABLED } from './config';

let client = null;

export function getSupabase() {
  if (!SUPABASE_ENABLED) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

// Fetch active tunnel URL published by the local computer to Supabase farm_config
export async function fetchLiveTunnelUrl() {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('farm_config')
      .select('value')
      .eq('key', 'tunnel_url')
      .maybeSingle();
    if (!error && data?.value && data.value.trim()) {
      return data.value.trim().replace(/\/+$/, '');
    }
  } catch (e) {
    console.warn('Failed to fetch live tunnel url from Supabase:', e);
  }
  return null;
}

