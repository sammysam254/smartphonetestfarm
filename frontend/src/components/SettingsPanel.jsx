import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Smartphone, 
  ShieldAlert, 
  ShieldCheck, 
  Trash2, 
  CheckCircle, 
  AlertCircle, 
  Server, 
  Link, 
  Copy, 
  Check, 
  Unlock, 
  Ban, 
  RefreshCw,
  Cpu
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import { getCoordinatorApi } from '../lib/config';
import './SettingsPanel.css';

function SettingsPanel({ token, devices: allDevices, showToast, isSuperAdmin, currentUser, userProfile, onProfileUpdate }) {
  const [activeTab, setActiveTab] = useState('team');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Create User Form
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  // Platform ID management
  const [editingPlatform, setEditingPlatform] = useState(false);
  const [platformInput, setPlatformInput] = useState(userProfile?.platform_id || '');
  const [copiedPlatform, setCopiedPlatform] = useState(false);

  const effectivePlatformId = userProfile?.platform_id || '';
  const currentUserId = userProfile?.id || currentUser?.sub;

  // Filter devices available to this admin:
  // - Super Admin sees all devices
  // - Admin sees devices matching their persistent platform_id
  const adminDevices = (allDevices || []).filter(d => {
    if (isSuperAdmin) return true;
    if (!effectivePlatformId) return false;
    return d.platform_id === effectivePlatformId;
  });

  // Fetch users according to SaaS isolation:
  // - Super Admin sees ALL users
  // - Admin sees STRICTLY users they created themselves (created_by === currentUserId)
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const sb = getSupabase();
      if (!sb) return;

      let query = sb.from('users').select('*').order('created_at', { ascending: false });
      if (!isSuperAdmin) {
        query = query.eq('created_by', currentUserId);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        setUsers(data);
      } else if (error) {
        showToast(error.message, 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();

    const sb = getSupabase();
    if (!sb) return;

    // Realtime subscriptions on users and devices
    const userChannel = sb
      .channel('saas_users_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchUsers();
      })
      .subscribe();

    return () => {
      sb.removeChannel(userChannel);
    };
  }, [currentUserId, isSuperAdmin]);

  // Create user under this Admin
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!userEmail.trim() || !userPassword) {
      showToast('Email and password are required', 'error');
      return;
    }
    if (userPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setCreatingUser(true);
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Database service unavailable');

      // 1. Sign up user via Supabase Auth with metadata
      const { data: authData, error: authError } = await sb.auth.signUp({
        email: userEmail.trim(),
        password: userPassword,
        options: {
          data: {
            created_by: currentUserId,
            platform_id: effectivePlatformId || null,
            role: 'user',
          },
        },
      });

      if (authError) throw authError;

      // 2. Explicitly ensure record exists in public.users with status active
      if (authData?.user?.id) {
        await sb.from('users').upsert({
          id: authData.user.id,
          email: userEmail.trim(),
          role: 'user',
          created_by: currentUserId,
          platform_id: effectivePlatformId || null,
          status: 'active',
          auth_provider: 'supabase',
          updated_at: new Date().toISOString(),
        });
      }

      showToast(`User ${userEmail.trim()} created successfully!`, 'success');
      setUserEmail('');
      setUserPassword('');
      fetchUsers();
    } catch (err) {
      showToast(`Failed to create user: ${err.message}`, 'error');
    } finally {
      setCreatingUser(false);
    }
  };

  // Toggle user suspension status (Block / Unblock)
  const handleToggleStatus = async (user) => {
    const nextStatus = user.status === 'suspended' ? 'active' : 'suspended';
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Database service unavailable');

      const { error } = await sb
        .from('users')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (error) throw error;

      showToast(`User ${user.email} is now ${nextStatus}!`, 'success');
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: nextStatus } : u));
    } catch (err) {
      showToast(`Error updating user status: ${err.message}`, 'error');
    }
  };

  // Assign device to sub-user
  const handleAssignDevice = async (serial, userId) => {
    if (!serial || !userId) return;
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Database service unavailable');

      const { error } = await sb
        .from('devices')
        .update({ allocated_to_user_id: userId, updated_at: new Date().toISOString() })
        .eq('serial', serial);

      if (error) throw error;

      showToast(`Device ${serial} assigned to user!`, 'success');
    } catch (err) {
      showToast(`Failed to assign device: ${err.message}`, 'error');
    }
  };

  // Revoke device assignment
  const handleRevokeDevice = async (serial) => {
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Database service unavailable');

      const { error } = await sb
        .from('devices')
        .update({ allocated_to_user_id: null, updated_at: new Date().toISOString() })
        .eq('serial', serial);

      if (error) throw error;

      showToast(`Assignment revoked for ${serial}!`, 'success');
    } catch (err) {
      showToast(`Failed to revoke device: ${err.message}`, 'error');
    }
  };

  // Force release active stream
  const handleForceReleaseStream = async (serial) => {
    try {
      const api = getCoordinatorApi();
      if (api) {
        await fetch(`${api}/api/v1/devices/${serial}/release`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
      }
      const sb = getSupabase();
      if (sb) {
        await sb.from('devices').update({ status: 'idle', stream_port: 0 }).eq('serial', serial);
      }
      showToast(`Device ${serial} stream force-released!`, 'success');
    } catch (err) {
      showToast(`Failed to release stream: ${err.message}`, 'error');
    }
  };

  // Update persistent Platform ID for this admin
  const handleSavePlatformId = async () => {
    const cleanId = platformInput.trim().toUpperCase();
    if (!cleanId) {
      showToast('Please enter a valid Platform ID', 'error');
      return;
    }
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Database service unavailable');

      // 🔍 STRICT VERIFICATION: Platform ID must be generated & registered by running start.bat
      const { data: configData } = await sb
        .from('farm_config')
        .select('key, value')
        .or(`key.eq.valid_platform_${cleanId},key.eq.tunnel_url_${cleanId}`);

      const { data: deviceData } = await sb
        .from('devices')
        .select('serial')
        .eq('platform_id', cleanId)
        .limit(1);

      const isValid = (configData && configData.length > 0) || (deviceData && deviceData.length > 0);

      if (!isValid) {
        throw new Error(`Invalid Platform ID '${cleanId}'. This ID was not generated by any running start.bat host script. Please run start.bat on your computer first to generate and register your Platform ID.`);
      }

      const { error } = await sb
        .from('users')
        .update({ platform_id: cleanId, updated_at: new Date().toISOString() })
        .eq('id', currentUserId);

      if (error) throw error;

      if (onProfileUpdate) {
        onProfileUpdate({ platform_id: cleanId });
      }
      setEditingPlatform(false);
      showToast(`Platform ID verified and linked to ${cleanId}!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const copyPlatformId = () => {
    if (!effectivePlatformId) return;
    navigator.clipboard.writeText(effectivePlatformId);
    setCopiedPlatform(true);
    setTimeout(() => setCopiedPlatform(false), 2000);
  };

  return (
    <div className="settings-panel">
      {/* 👑 ENTERPRISE HERO HEADER */}
      <div className="settings-hero">
        <div className="settings-hero-content">
          <h2>
            {isSuperAdmin ? 'Platform Super-Admin Console' : 'Device Farm Management'}
          </h2>
          <p>
            {isSuperAdmin 
              ? 'Global multi-tenant governance. Monitor all farm hosts, manage administrator privileges, revoke active streams, and oversee tenant isolation.'
              : 'Manage team access, allocate smartphones to specific users, and bind your local computer farm host using your persistent Platform ID.'}
          </p>
        </div>

        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <Cpu className="admin-stat-icon" size={24} style={{ color: '#3b82f6' }} />
            <div className="admin-stat-info">
              <span className="admin-stat-label">Host Devices</span>
              <span className="admin-stat-value">{adminDevices.length}</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <Users className="admin-stat-icon" size={24} style={{ color: '#10b981' }} />
            <div className="admin-stat-info">
              <span className="admin-stat-label">{isSuperAdmin ? 'Total Users' : 'Team Members'}</span>
              <span className="admin-stat-value">{users.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 🏷️ PERSISTENT PLATFORM ID LINK BANNER */}
      <div className="platform-link-banner">
        <div className="platform-link-header">
          <Server size={20} style={{ color: '#60a5fa' }} />
          <h3>Host Machine Platform ID</h3>
          {effectivePlatformId ? (
            <span className="platform-linked-pill" style={{ margin: 0 }}>
              <CheckCircle size={14} /> Linked & Active
            </span>
          ) : (
            <span style={{ color: '#f59e0b', fontSize: '13px', fontWeight: 600 }}>
              ⚠️ Not Linked (Run start.bat on your computer to obtain your ID)
            </span>
          )}
        </div>

        {editingPlatform || !effectivePlatformId ? (
          <div className="platform-link-form">
            <input 
              type="text" 
              className="platform-input"
              placeholder="e.g. FP-HOST-C549AC85"
              value={platformInput}
              onChange={(e) => setPlatformInput(e.target.value.toUpperCase())}
            />
            <button className="btn-link-platform" onClick={handleSavePlatformId}>
              Verify & Link Platform ID
            </button>
            {effectivePlatformId && (
              <button 
                className="btn-secondary" 
                style={{ padding: '10px 16px', background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', cursor: 'pointer' }}
                onClick={() => setEditingPlatform(false)}
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <code style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.05em', color: '#60a5fa', background: 'rgba(0,0,0,0.3)', padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.3)' }}>
                {effectivePlatformId}
              </code>
              <button 
                onClick={copyPlatformId} 
                style={{ background: 'transparent', border: 'none', color: copiedPlatform ? '#10b981' : '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
              >
                {copiedPlatform ? <Check size={16} /> : <Copy size={16} />}
                <span>{copiedPlatform ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <button 
              onClick={() => { setPlatformInput(effectivePlatformId); setEditingPlatform(true); }}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
            >
              Change Platform ID
            </button>
          </div>
        )}
      </div>

      {/* 🧭 NAVIGATION TABS */}
      <div className="settings-tabs">
        <button 
          className={`settings-tab-btn ${activeTab === 'team' ? 'active' : ''}`}
          onClick={() => setActiveTab('team')}
        >
          <Users size={16} />
          <span>{isSuperAdmin ? 'All Users & Admins' : 'My Team Members'}</span>
        </button>

        <button 
          className={`settings-tab-btn ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={() => setActiveTab('devices')}
        >
          <Smartphone size={16} />
          <span>Device Allocation ({adminDevices.length})</span>
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: TEAM MEMBERS & SUB-USER CREATION
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'team' && (
        <div className="tab-pane">
          {/* Create User Form */}
          <div className="panel-card" style={{ marginBottom: '24px' }}>
            <div className="card-header">
              <UserPlus size={18} style={{ color: '#3b82f6' }} />
              <h3>{isSuperAdmin ? 'Create New User or Admin' : 'Create Sub-User for Your Team'}</h3>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 16px 0' }}>
              {isSuperAdmin 
                ? 'Create a new user account in Supabase. Admins will only see and manage their own created users.'
                : 'Users created here are strictly scoped to your account. You can assign them smartphones from your farm.'}
            </p>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <input 
                  type="email"
                  placeholder="Team member email"
                  required
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', outline: 'none' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <input 
                  type="password"
                  placeholder="Password (min 6 chars)"
                  required
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', outline: 'none' }}
                />
              </div>
              <button 
                type="submit" 
                disabled={creatingUser}
                className="btn-primary"
                style={{ padding: '10px 22px', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                {creatingUser ? <RefreshCw size={16} className="spin" /> : <UserPlus size={16} />}
                <span>{creatingUser ? 'Creating...' : 'Create User'}</span>
              </button>
            </form>
          </div>

          {/* Team Members List */}
          <div className="panel-card">
            <div className="card-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={18} style={{ color: '#10b981' }} />
                <h3>{isSuperAdmin ? 'Directory of Users & Admins' : 'Your Created Users'} ({users.length})</h3>
              </div>
              <button 
                onClick={fetchUsers} 
                className="btn-refresh" 
                title="Refresh user list"
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <RefreshCw size={16} className={loadingUsers ? 'spin' : ''} />
              </button>
            </div>

            {loadingUsers ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No users found. Create your first team member above!
              </div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: '16px' }}>
                <table className="enterprise-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px' }}>
                      <th style={{ padding: '12px 16px' }}>Email</th>
                      <th style={{ padding: '12px 16px' }}>Role</th>
                      <th style={{ padding: '12px 16px' }}>Status</th>
                      <th style={{ padding: '12px 16px' }}>Assigned Devices</th>
                      <th style={{ padding: '12px 16px' }}>Assign New Device</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const userAssignedDevices = (allDevices || []).filter(d => d.allocated_to_user_id === u.id);
                      const isSuspended = u.status === 'suspended';

                      return (
                        <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '13px' }}>
                          <td style={{ padding: '14px 16px', fontWeight: 500, color: '#f8fafc' }}>
                            {u.email}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ 
                              padding: '3px 8px', 
                              borderRadius: '4px', 
                              fontSize: '11px', 
                              fontWeight: 600, 
                              textTransform: 'uppercase',
                              background: u.role === 'admin' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                              color: u.role === 'admin' ? '#c084fc' : '#60a5fa',
                              border: u.role === 'admin' ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)'
                            }}>
                              {u.role}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ 
                              padding: '3px 8px', 
                              borderRadius: '4px', 
                              fontSize: '11px', 
                              fontWeight: 600,
                              background: isSuspended ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: isSuspended ? '#ef4444' : '#10b981',
                              border: isSuspended ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              {isSuspended ? <Ban size={12} /> : <CheckCircle size={12} />}
                              {isSuspended ? 'Suspended' : 'Active'}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {userAssignedDevices.length === 0 ? (
                              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>None</span>
                            ) : (
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {userAssignedDevices.map(dev => (
                                  <span key={dev.serial} style={{ 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '6px', 
                                    background: 'rgba(255,255,255,0.06)', 
                                    padding: '3px 8px', 
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                  }}>
                                    <span>{dev.model || dev.serial}</span>
                                    <button 
                                      onClick={() => handleRevokeDevice(dev.serial)} 
                                      title="Revoke device assignment"
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 2px' }}
                                    >
                                      ✕
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <select 
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleAssignDevice(e.target.value, u.id);
                                  e.target.value = "";
                                }
                              }}
                              style={{ 
                                background: 'rgba(0,0,0,0.4)', 
                                border: '1px solid rgba(255,255,255,0.15)', 
                                color: '#e2e8f0', 
                                padding: '6px 10px', 
                                borderRadius: '6px',
                                fontSize: '12px',
                                outline: 'none'
                              }}
                            >
                              <option value="" disabled>+ Assign a device...</option>
                              {adminDevices.map(d => (
                                <option key={d.serial} value={d.serial}>
                                  {d.model || d.serial} ({d.serial}) {d.allocated_to_user_id === u.id ? '✓ (Currently Assigned)' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <button
                              onClick={() => handleToggleStatus(u)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: 'none',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                background: isSuspended ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: isSuspended ? '#10b981' : '#ef4444',
                                border: isSuspended ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                                transition: 'all 0.2s'
                              }}
                            >
                              {isSuspended ? 'Activate User' : 'Suspend User'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: DEVICE MANAGEMENT & STREAM RECOVERY
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'devices' && (
        <div className="tab-pane">
          <div className="panel-card">
            <div className="card-header">
              <Smartphone size={18} style={{ color: '#3b82f6' }} />
              <h3>Farm Devices ({adminDevices.length})</h3>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 16px 0' }}>
              {isSuperAdmin 
                ? 'All devices in Supabase across all cloud platform IDs. You can force-release streams or revoke assignments.'
                : `Devices connected to your persistent Platform ID (${effectivePlatformId || 'Unlinked'}).`}
            </p>

            {adminDevices.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No devices found for Platform ID <code>{effectivePlatformId || 'None'}</code>.<br />
                Ensure your device is connected via USB and <code>start.bat</code> is running on your machine.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px' }}>
                      <th style={{ padding: '12px 16px' }}>Device</th>
                      <th style={{ padding: '12px 16px' }}>Serial</th>
                      <th style={{ padding: '12px 16px' }}>Platform ID</th>
                      <th style={{ padding: '12px 16px' }}>Status</th>
                      <th style={{ padding: '12px 16px' }}>Assigned To</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminDevices.map(d => {
                      const assignedUser = (users || []).find(u => u.id === d.allocated_to_user_id);

                      return (
                        <tr key={d.serial} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '13px' }}>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f8fafc' }}>
                            {d.model || 'Android Device'}
                          </td>
                          <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#94a3b8' }}>
                            {d.serial}
                          </td>
                          <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#60a5fa' }}>
                            {d.platform_id || 'unassigned'}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ 
                              padding: '3px 8px', 
                              borderRadius: '4px', 
                              fontSize: '11px', 
                              fontWeight: 600,
                              background: d.status === 'claimed' ? 'rgba(59, 130, 246, 0.15)' : d.status === 'idle' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                              color: d.status === 'claimed' ? '#60a5fa' : d.status === 'idle' ? '#10b981' : '#94a3b8'
                            }}>
                              {d.status}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {assignedUser ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#f8fafc' }}>
                                <span>{assignedUser.email}</span>
                                <button 
                                  onClick={() => handleRevokeDevice(d.serial)} 
                                  title="Revoke assignment"
                                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                                >
                                  ✕
                                </button>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Unassigned (Public)</span>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <button
                              onClick={() => handleForceReleaseStream(d.serial)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                transition: 'all 0.2s'
                              }}
                            >
                              Release Stream
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPanel;
