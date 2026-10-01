import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { SUPABASE_ENABLED } from './lib/config'
import { getSupabase } from './lib/supabase'

// Resolve the best available auth token for API calls. When Supabase Auth is
// configured the live session token wins (auto-refreshed by supabase-js);
// otherwise the token from the local login flow is used.
async function resolveApiToken() {
  if (SUPABASE_ENABLED) {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) return data.session.access_token;
  }
  return localStorage.getItem('token');
}

// Patch global window.fetch to inject JWT authorization header and handle token expiration/invalidation
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const token = await resolveApiToken();
  if (token && url.toString().includes('/api/v1/')) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }

  const response = await originalFetch(url, options);

  // Clear token and notify app if the session is unauthorized/expired (excluding the login request itself)
  if (response.status === 401 && !url.toString().includes('/api/v1/auth/login')) {
    localStorage.removeItem('token');
    window.dispatchEvent(new Event('auth-unauthorized'));
  }

  return response;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />,
)
