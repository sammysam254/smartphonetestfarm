import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import StatsBar from './components/StatsBar';
import DeviceCard from './components/DeviceCard';
import DevicePage from './components/DevicePage';
import DeviceDetailsTable from './components/DeviceDetailsTable';
import SettingsPanel from './components/SettingsPanel';
import Login from './components/Login';
import { useDevicesWS } from './hooks/useDevicesWS';
import { COORDINATOR_API, SUPABASE_ENABLED, updateCoordinatorApi, getCoordinatorApi } from './lib/config';
import { getSupabase, fetchLiveTunnelUrl } from './lib/supabase';
import { ShieldAlert, Server, CheckCircle, RefreshCw } from 'lucide-react';
import './App.css';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const { devices, loading: wsLoading, wsError, setDevices } = useDevicesWS(token);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [activeTab, setActiveTab] = useState('device');
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const lastClaimedPath = useRef('');

  // User Profile state from Supabase public.users
  const [userProfile, setUserProfile] = useState(null);
  const [platformInput, setPlatformInput] = useState('');
  const [linkingPlatform, setLinkingPlatform] = useState(false);

  const parseJwt = (t) => {
    try {
      return JSON.parse(atob(t.split('.')[1]));
    } catch (e) {
      return null;
    }
  };

  const decoded = token ? parseJwt(token) : null;

  // Determine roles based on email and Supabase user record
  const isSuperAdmin = 
    decoded?.email?.toLowerCase() === 'sammyseth260@gmail.com' || 
    userProfile?.email?.toLowerCase() === 'sammyseth260@gmail.com';

  const isAdmin = 
    isSuperAdmin || 
    userProfile?.role === 'admin' || 
    decoded?.role === 'admin' ||
    (!userProfile?.created_by && userProfile?.role !== 'user');

  const isSubUser = !isSuperAdmin && !isAdmin;
  const isSuspended = userProfile?.status === 'suspended';

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setToken('');
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth-unauthorized', handleUnauthorized);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUserProfile(null);
    if (SUPABASE_ENABLED) {
      const supabase = getSupabase();
      supabase?.auth.signOut().catch(() => {});
    }
    showToast('Logged out successfully', 'success');
  };

  // Sync token with Supabase Auth session
  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    const supabase = getSupabase();
    if (!supabase) return;

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data?.session?.access_token) {
        localStorage.setItem('token', data.session.access_token);
        setToken(data.session.access_token);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.access_token) {
        localStorage.removeItem('token');
        setToken('');
        setUserProfile(null);
        return;
      }
      localStorage.setItem('token', session.access_token);
      setToken(session.access_token);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Fetch and subscribe to public.users profile (for suspension & platform_id)
  useEffect(() => {
    if (!token) {
      setUserProfile(null);
      return;
    }
    const currentSub = decoded?.sub;
    if (!currentSub || !SUPABASE_ENABLED) return;

    const sb = getSupabase();
    if (!sb) return;

    let mounted = true;

    const loadProfile = async () => {
      try {
        const { data, error } = await sb
          .from('users')
          .select('*')
          .eq('id', currentSub)
          .maybeSingle();

        if (mounted && data) {
          setUserProfile(data);
          if (data.platform_id) {
            setPlatformInput(data.platform_id);
          }
        }
      } catch (err) {
        console.warn('Failed to load user profile:', err);
      }
    };

    loadProfile();

    const channel = sb
      .channel(`profile_sync_${currentSub}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users', filter: `id=eq.${currentSub}` },
        (payload) => {
          if (mounted && payload.new) {
            setUserProfile(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      sb.removeChannel(channel);
    };
  }, [token, decoded?.sub]);

  // Dynamically synchronize live tunnel URL published by the local host to Supabase
  useEffect(() => {
    if (!SUPABASE_ENABLED) return;

    fetchLiveTunnelUrl().then((liveUrl) => {
      if (liveUrl && liveUrl !== COORDINATOR_API) {
        updateCoordinatorApi(liveUrl);
        window.dispatchEvent(new CustomEvent('coordinator-api-updated', { detail: liveUrl }));
      }
    });

    const sb = getSupabase();
    if (!sb) return;

    const channel = sb
      .channel('tunnel_live_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'farm_config' }, (payload) => {
        if (payload?.new?.key === 'tunnel_url' && payload?.new?.value) {
          const newUrl = payload.new.value.trim().replace(/\/+$/, '');
          if (newUrl && newUrl !== COORDINATOR_API) {
            updateCoordinatorApi(newUrl);
            window.dispatchEvent(new CustomEvent('coordinator-api-updated', { detail: newUrl }));
          }
        }
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // SAAS MULTI-TENANT DEVICE FILTERING
  // 1. Super Admin: sees ALL devices in Supabase across all platforms
  // 2. Admin: sees devices uploaded by their verified persistent platform_id
  // 3. Sub-user: strictly sees ONLY the device assigned to their account
  // ─────────────────────────────────────────────────────────────────────────────
  const scopedDevices = devices.filter((d) => {
    if (isSuperAdmin) return true;
    if (isAdmin) {
      if (!userProfile?.platform_id) return false;
      return d.platform_id === userProfile.platform_id;
    }
    // Sub-user: strictly assigned devices only
    return d.allocated_to_user_id === userProfile?.id;
  });

  const orderedDevices = [...scopedDevices].sort((a, b) => {
    const statusOrder = { claimed: 1, idle: 2, busy: 3, offline: 4 };
    const orderA = statusOrder[a.status?.toLowerCase()] || 5;
    const orderB = statusOrder[b.status?.toLowerCase()] || 5;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.connected_at || 0) - new Date(a.connected_at || 0);
  });

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // Derive activeDevice from path `/device/:serial`
  let activeDevice = null;
  const pathMatch = currentPath.match(/^\/device\/([^/]+)/);
  if (pathMatch) {
    const serial = pathMatch[1];
    const found = scopedDevices.find((d) => d.serial === serial);
    if (found) {
      activeDevice = {
        ...found,
        streamPort: found.stream_port || 0,
      };
    } else {
      activeDevice = {
        serial,
        model: 'Loading...',
        manufacturer: '',
        status: 'claimed',
        streamPort: 0,
      };
    }
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  };

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleClaim = async (device) => {
    try {
      showToast(`Claiming ${device.model || device.serial}...`, 'success');
      const api = getCoordinatorApi() || COORDINATOR_API;
      if (!api) {
        showToast('Local farm streaming host is offline or tunnel connecting...', 'error');
        return;
      }
      const res = await fetch(`${api}/api/v1/devices/${device.serial}/claim?user=dev-user`, {
        method: 'POST',
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP error ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        showToast('Device claimed successfully!', 'success');
        setDevices((prev) =>
          prev.map((d) =>
            d.serial === device.serial
              ? { ...d, status: 'claimed', stream_port: data.port }
              : d
          )
        );
        if (SUPABASE_ENABLED) {
          const sb = getSupabase();
          if (sb) {
            sb.from('devices').update({ status: 'claimed', stream_port: data.port }).eq('serial', device.serial).then();
          }
        }
        navigate(`/device/${device.serial}`);
      }
    } catch (err) {
      showToast(`Claim failed: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    if (currentPath.startsWith('/device/') && activeDevice && activeDevice.status === 'idle') {
      if (lastClaimedPath.current !== currentPath) {
        lastClaimedPath.current = currentPath;
        handleClaim(activeDevice);
      }
    } else if (!currentPath.startsWith('/device/')) {
      lastClaimedPath.current = '';
    }
  }, [currentPath, activeDevice?.status]);

  const handleRelease = async (serial) => {
    try {
      showToast(`Releasing device...`, 'success');
      const api = getCoordinatorApi() || COORDINATOR_API;
      if (api) {
        const res = await fetch(`${api}/api/v1/devices/${serial}/release`, {
          method: 'POST',
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `HTTP error ${res.status}`);
        }
        await res.json();
      }
      showToast('Device released!', 'success');
      if (SUPABASE_ENABLED) {
        const sb = getSupabase();
        if (sb) {
          sb.from('devices').update({ status: 'idle', stream_port: 0 }).eq('serial', serial).then();
        }
      }
      if (activeDevice && activeDevice.serial === serial) {
        navigate('/');
      }
    } catch (err) {
      showToast(`Release failed: ${err.message}`, 'error');
    }
  };

  // Link Platform ID from dashboard
  const handleLinkPlatformId = async (e) => {
    e?.preventDefault();
    const cleanId = platformInput.trim().toUpperCase();
    if (!cleanId) {
      showToast('Please enter a valid Platform ID', 'error');
      return;
    }
    setLinkingPlatform(true);
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Database service unavailable');

      const { error } = await sb
        .from('users')
        .update({ platform_id: cleanId, updated_at: new Date().toISOString() })
        .eq('id', userProfile?.id || decoded?.sub);

      if (error) throw error;

      setUserProfile((prev) => ({ ...prev, platform_id: cleanId }));
      showToast(`Platform ID ${cleanId} linked successfully!`, 'success');
    } catch (err) {
      showToast(`Failed to link platform ID: ${err.message}`, 'error');
    } finally {
      setLinkingPlatform(false);
    }
  };

  // 🛑 SUSPENDED USER SCREEN
  if (token && isSuspended) {
    return (
      <div className="suspended-screen">
        <div className="suspended-card">
          <div className="suspended-icon-glow">
            <ShieldAlert size={40} color="#ef4444" />
          </div>
          <h2>Account Suspended</h2>
          <p className="suspended-email">{userProfile?.email || decoded?.email}</p>
          <p className="suspended-msg">
            Your access has been revoked by your administrator. You are currently restricted from accessing smartphones, active stream sessions, or platform resources.
          </p>
          <button className="btn-suspended-logout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (!token) {
    return <Login onLoginSuccess={(newToken) => setToken(newToken)} />;
  }

  return (
    <div className={`layout ${activeDevice ? 'has-active-device' : ''}`}>
      <Header 
        theme={theme} 
        toggleTheme={toggleTheme} 
        onLogout={handleLogout} 
        isAdmin={isAdmin}
        activeTab={activeTab}
        currentUser={userProfile || decoded}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (activeDevice) {
            navigate('/');
          }
        }}
      />

      <main className="main">
        {activeDevice ? (
          <DevicePage
            device={activeDevice}
            token={token}
            onBack={() => navigate('/')}
            onRelease={() => handleRelease(activeDevice.serial)}
          />
        ) : activeTab === 'settings' && isAdmin ? (
          <SettingsPanel
            token={token}
            devices={devices}
            showToast={showToast}
            isSuperAdmin={isSuperAdmin}
            currentUser={decoded}
            userProfile={userProfile}
            onProfileUpdate={(updated) => setUserProfile((prev) => ({ ...prev, ...updated }))}
          />
        ) : (
          <>
            <StatsBar devices={scopedDevices} />

            {/* Prompt Admin to Link Platform ID if unlinked */}
            {isAdmin && !isSuperAdmin && !userProfile?.platform_id && (
              <div className="platform-link-banner" style={{ margin: '16px 0 24px 0' }}>
                <div className="platform-link-header">
                  <Server size={20} style={{ color: '#60a5fa' }} />
                  <h3>Link Your Farm Host (Platform ID)</h3>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                  Run <code>start.bat</code> on your computer to view your persistent Platform ID (e.g. <code>FP-HOST-C549AC85</code>). Enter it here to verify and display your attached smartphones:
                </p>
                <form onSubmit={handleLinkPlatformId} className="platform-link-form">
                  <input
                    type="text"
                    className="platform-input"
                    placeholder="Enter Platform ID (e.g. FP-HOST-C549AC85)"
                    value={platformInput}
                    onChange={(e) => setPlatformInput(e.target.value.toUpperCase())}
                  />
                  <button type="submit" disabled={linkingPlatform} className="btn-link-platform">
                    {linkingPlatform ? 'Verifying...' : 'Verify & Link Devices'}
                  </button>
                </form>
              </div>
            )}

            <div className="device-dashboard-tabs">
              <button 
                className={`tab-nav-btn ${activeTab === 'device' ? 'active' : ''}`} 
                onClick={() => setActiveTab('device')}
              >
                Devices ({orderedDevices.length})
              </button>
              <button 
                className={`tab-nav-btn ${activeTab === 'details' ? 'active' : ''}`} 
                onClick={() => setActiveTab('details')}
              >
                Details
              </button>
            </div>

            {activeTab === 'device' ? (
              <div className="device-grid">
                {orderedDevices.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px auto', display: 'block', color: 'var(--text-muted)' }}>
                        <rect x="5" y="2" width="14" height="20" rx="2.5" ry="2.5" />
                        <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5" />
                      </svg>
                    </div>
                    <h3>
                      {isSubUser 
                        ? 'No Devices Assigned' 
                        : !userProfile?.platform_id 
                        ? 'Platform ID Required' 
                        : 'No Devices Connected'}
                    </h3>
                    <p>
                      {isSubUser 
                        ? 'Your administrator has not assigned any smartphones to your account yet. Please contact your administrator.'
                        : !userProfile?.platform_id 
                        ? 'Link your computer Platform ID above to display your devices.' 
                        : 'Ensure adb is running, your smartphone is connected via USB, and start.bat is active.'}
                    </p>
                  </div>
                ) : (
                  orderedDevices.map((device) => (
                    <DeviceCard
                      key={device.serial}
                      device={device}
                      onClaim={handleClaim}
                      onViewStream={(serial) => navigate(`/device/${serial}`)}
                      onRelease={handleRelease}
                    />
                  ))
                )}
              </div>
            ) : (
              <DeviceDetailsTable 
                devices={orderedDevices} 
                onClaim={handleClaim} 
                onViewStream={(serial) => navigate(`/device/${serial}`)} 
                onRelease={handleRelease} 
              />
            )}
          </>
        )}
      </main>

      {/* Toasts */}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
