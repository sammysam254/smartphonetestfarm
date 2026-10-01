import React, { useState, useEffect } from 'react';
import { 
  Users, 
  FolderPlus, 
  Trash2, 
  UserPlus, 
  Layers, 
  Calendar, 
  Clock, 
  Smartphone, 
  UserMinus,
  CheckCircle,
  AlertCircle,
  Mail,
  ShieldAlert,
  ArrowRight,
  Database,
  CalendarDays
} from 'lucide-react';
import './SettingsPanel.css';
import { getCoordinatorApi } from '../lib/config';

function SettingsPanel({ token, devices: allDevices, showToast, isSuperAdmin, currentUser }) {
  const [activeSubTab, setActiveSubTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  
  // Loading & error states
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Form states - Create User
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState('user');
  const [userGroup, setUserGroup] = useState('Public');
  const [creatingUser, setCreatingUser] = useState(false);

  // Form states - Create Group
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupAdminId, setGroupAdminId] = useState('');
  const [groupExpiry, setGroupExpiry] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Allocations states
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupUsers, setGroupUsers] = useState([]);
  const [groupDeviceSerials, setGroupDeviceSerials] = useState([]);
  const [loadingAllocations, setLoadingAllocations] = useState(false);
  const [allocateUserId, setAllocateUserId] = useState('');
  const [allocateSerial, setAllocateSerial] = useState('');

  // Robust API Fetcher that handles offline coordinator and HTML responses gracefully
  const apiFetch = async (endpoint, options = {}) => {
    const base = getCoordinatorApi();
    if (!base) {
      throw new Error('Local farm coordinator is offline. Please launch start.bat on your PC.');
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    };
    const res = await fetch(`${base}${endpoint}`, { ...options, headers });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      if (contentType.includes('text/html')) {
        throw new Error('Local farm coordinator is offline. Launch start.bat on your PC to stream.');
      }
      const txt = await res.text();
      throw new Error(txt || `HTTP error ${res.status}`);
    }
    return res.json();
  };

  // Fetch all users
  const fetchUsers = async () => {
    if (!getCoordinatorApi()) return;
    setLoadingUsers(true);
    try {
      const data = await apiFetch('/api/v1/admin/users');
      setUsers(data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  // Fetch all groups
  const fetchGroups = async () => {
    if (!getCoordinatorApi()) return;
    setLoadingGroups(true);
    try {
      const data = await apiFetch('/api/v1/admin/groups');
      setGroups(data || []);
      if (data && data.length > 0) {
        if (!selectedGroupId) {
          setSelectedGroupId(data[0].id);
        }
        const hasPublic = data.some(g => g.name === 'Public');
        if (!hasPublic) {
          setUserGroup(data[0].name);
        }
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoadingGroups(false);
    }
  };

  // Fetch group specific users and devices
  const fetchGroupAllocations = async (groupId) => {
    if (!groupId || !getCoordinatorApi()) return;
    setLoadingAllocations(true);
    try {
      const uData = await apiFetch(`/api/v1/admin/groups/${groupId}/users`);
      const dData = await apiFetch(`/api/v1/admin/groups/${groupId}/devices`);
      setGroupUsers(uData || []);
      setGroupDeviceSerials(dData || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoadingAllocations(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'users') {
      fetchUsers();
      fetchGroups();
    } else if (activeSubTab === 'groups') {
      fetchGroups();
    } else if (activeSubTab === 'allocations') {
      fetchUsers();
      fetchGroups();
    }
  }, [activeSubTab]);

  useEffect(() => {
    if (selectedGroupId && activeSubTab === 'allocations') {
      fetchGroupAllocations(selectedGroupId);
    }
  }, [selectedGroupId, activeSubTab]);

  // Auto-reload when coordinator tunnel URL connects or changes
  useEffect(() => {
    const handleApiUpdate = () => {
      fetchUsers();
      fetchGroups();
      if (selectedGroupId) fetchGroupAllocations(selectedGroupId);
    };
    window.addEventListener('coordinator-api-updated', handleApiUpdate);
    return () => window.removeEventListener('coordinator-api-updated', handleApiUpdate);
  }, [selectedGroupId]);

  // Create User Handler
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!userEmail || !userPassword) return;
    setCreatingUser(true);
    try {
      await apiFetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          role: userRole,
          groups: [userGroup]
        })
      });
      showToast('User registered successfully!', 'success');
      setUserEmail('');
      setUserPassword('');
      setUserRole('user');
      setUserGroup('Public');
      fetchUsers();
    } catch (err) {
      showToast(`User creation failed: ${err.message}`, 'error');
    } finally {
      setCreatingUser(false);
    }
  };

  // Delete User Handler
  const handleDeleteUser = async (userId, email) => {
    if (!window.confirm(`Are you sure you want to delete user: ${email}?`)) return;
    try {
      await apiFetch(`/api/v1/admin/users?id=${userId}`, {
        method: 'DELETE'
      });
      showToast('User deleted successfully', 'success');
      fetchUsers();
    } catch (err) {
      showToast(`Deletion failed: ${err.message}`, 'error');
    }
  };

  // Create Group Handler
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupName) return;
    setCreatingGroup(true);
    try {
      const payload = {
        name: groupName,
        description: groupDesc,
        admin_id: groupAdminId || null
      };
      if (groupExpiry) {
        payload.expires_at = new Date(groupExpiry).toISOString();
      }

      await apiFetch('/api/v1/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('Group created successfully with assigned admin!', 'success');
      setGroupName('');
      setGroupDesc('');
      setGroupAdminId('');
      setGroupExpiry('');
      fetchGroups();
      fetchUsers();
    } catch (err) {
      showToast(`Group creation failed: ${err.message}`, 'error');
    } finally {
      setCreatingGroup(false);
    }
  };

  // Delete Group Handler
  const handleDeleteGroup = async (groupId, name) => {
    if (!window.confirm(`Are you sure you want to delete group: ${name}?`)) return;
    try {
      await apiFetch(`/api/v1/admin/groups/${groupId}`, {
        method: 'DELETE'
      });
      showToast('Group deleted successfully', 'success');
      fetchGroups();
    } catch (err) {
      showToast(`Group deletion failed: ${err.message}`, 'error');
    }
  };

  // Add User to Group
  const handleAddUserToGroup = async (e) => {
    e.preventDefault();
    if (!allocateUserId || !selectedGroupId) return;
    try {
      await apiFetch(`/api/v1/admin/groups/${selectedGroupId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: allocateUserId })
      });
      showToast('User added to group', 'success');
      setAllocateUserId('');
      fetchGroupAllocations(selectedGroupId);
    } catch (err) {
      showToast(`Failed to add user: ${err.message}`, 'error');
    }
  };

  // Remove User from Group
  const handleRemoveUserFromGroup = async (userId) => {
    if (!window.confirm('Remove user from group?')) return;
    try {
      await apiFetch(`/api/v1/admin/groups/${selectedGroupId}/users/${userId}`, {
        method: 'DELETE'
      });
      showToast('User removed from group', 'success');
      fetchGroupAllocations(selectedGroupId);
    } catch (err) {
      showToast(`Failed to remove user: ${err.message}`, 'error');
    }
  };

  // Add Device to Group
  const handleAddDeviceToGroup = async (e) => {
    e.preventDefault();
    if (!allocateSerial || !selectedGroupId) return;
    try {
      await apiFetch(`/api/v1/admin/groups/${selectedGroupId}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: allocateSerial })
      });
      showToast('Device allocated to group', 'success');
      setAllocateSerial('');
      fetchGroupAllocations(selectedGroupId);
    } catch (err) {
      showToast(`Failed to allocate device: ${err.message}`, 'error');
    }
  };

  // Remove Device from Group (Super Admin action)
  const handleRemoveDeviceFromGroup = async (serial) => {
    if (!window.confirm('Deallocate device from group?')) return;
    try {
      await apiFetch(`/api/v1/admin/groups/${selectedGroupId}/devices/${serial}`, {
        method: 'DELETE'
      });
      showToast('Device deallocated from group', 'success');
      fetchGroupAllocations(selectedGroupId);
    } catch (err) {
      showToast(`Failed to remove device: ${err.message}`, 'error');
    }
  };

  // Assign or Share Device with specific group user (Group Admin & Super Admin)
  const handleAssignDeviceToUser = async (serial, userId) => {
    try {
      await apiFetch(`/api/v1/admin/groups/${selectedGroupId}/devices/${serial}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId || null })
      });
      showToast(userId ? 'Device assigned to selected group member' : 'Device shared with all group members', 'success');
      fetchGroupAllocations(selectedGroupId);
    } catch (err) {
      showToast(`Failed to update assignment: ${err.message}`, 'error');
    }
  };

  const isGroupExpired = (group) => {
    if (!group.expires_at) return false;
    return new Date(group.expires_at) < new Date();
  };

  // Format Date Helper
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Compute some quick statistics
  const adminStats = {
    totalUsers: users.length,
    totalGroups: groups.length,
    activeGroups: groups.filter(g => !isGroupExpired(g)).length,
    totalDevices: allDevices.length
  };

  return (
    <div className="settings-panel">
      {/* 👑 ENTERPRISE HERO HEADER */}
      <div className="settings-hero">
        <div className="settings-hero-content">
          <h2>Administration & Governance</h2>
          <p>Configure enterprise users, design logical device access scopes, track expirations, and allocate smartphone inventory.</p>
        </div>

        {/* 📊 REAL-TIME STATS BAR */}
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <div className="stat-icon-wrap"><Users size={18} /></div>
            <div className="stat-info">
              <span className="stat-val">{adminStats.totalUsers}</span>
              <span className="stat-label">Total Users</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="stat-icon-wrap"><Layers size={18} /></div>
            <div className="stat-info">
              <span className="stat-val">{adminStats.activeGroups} <small style={{fontSize: 11}}>/ {adminStats.totalGroups}</small></span>
              <span className="stat-label">Active Groups</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="stat-icon-wrap"><Smartphone size={18} /></div>
            <div className="stat-info">
              <span className="stat-val">{adminStats.totalDevices}</span>
              <span className="stat-label">Smartphones</span>
            </div>
          </div>
        </div>
      </div>

      {!getCoordinatorApi() && (
        <div className="offline-farm-banner">
          <AlertCircle size={20} className="offline-icon" />
          <div className="offline-text">
            <strong>Local Streaming Farm is Offline</strong>
            <p>
              To manage live users, groups, and device streams from this dashboard, double-click <code>start.bat</code> on your PC. 
              The Cloudflare Quick Tunnel will automatically synchronize with this dashboard. You can also click <strong>Tunnel</strong> in the top header to enter your tunnel URL manually.
            </p>
          </div>
        </div>
      )}

      {/* 🚀 SUB-TAB SWITCHER */}
      <div className="settings-sub-navigation">
        <button
          className={`settings-nav-tab ${activeSubTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('users')}
        >
          <Users size={16} />
          <span>User Management</span>
        </button>
        <button
          className={`settings-nav-tab ${activeSubTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('groups')}
        >
          <FolderPlus size={16} />
          <span>Groups & Access Expiry</span>
        </button>
        <button
          className={`settings-nav-tab ${activeSubTab === 'allocations' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('allocations')}
        >
          <Layers size={16} />
          <span>Members & Devices</span>
        </button>
      </div>

      {/* ⚡ ACTIVE TAB VIEW */}
      <div className="settings-view-viewport">
        {/* ─── USERS VIEW ─── */}
        {activeSubTab === 'users' && (
          <div className="settings-grid-layout">
            <div className="settings-main-card">
              <div className="card-header-bar">
                <h3>Directory Users</h3>
                <span className="count-badge">{users.length} accounts</span>
              </div>
              {loadingUsers ? (
                <div className="settings-spinner-wrapper"><span className="settings-spinner"></span></div>
              ) : (
                <div className="settings-table-wrapper">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Email Address</th>
                        <th>User Role</th>
                        <th>Auth Provider</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="empty-table-state">
                            <ShieldAlert size={24} />
                            <p>No user accounts found. Database requires seeding.</p>
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr key={u.id}>
                            <td className="user-email-col">
                              <Mail size={14} className="cell-icon" />
                              <span>{u.email}</span>
                            </td>
                            <td>
                              <span className={`role-badge ${u.role}`}>
                                {u.role}
                              </span>
                            </td>
                            <td>
                              <span className="provider-pill">{u.auth_provider}</span>
                            </td>
                            <td className="time-col">{formatDate(u.created_at)}</td>
                            <td>
                              <button
                                className="settings-action-btn danger-icon"
                                onClick={() => handleDeleteUser(u.id, u.email)}
                                disabled={u.role === 'admin' || u.email === 'admin@domain.com'}
                                title={u.role === 'admin' || u.email === 'admin@domain.com' ? 'Administrator accounts cannot be deleted here' : 'Delete User Account'}
                              >
                                <Trash2 size={14} />
                                <span>Delete</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="settings-side-card">
              <div className="form-card-header">
                <UserPlus size={18} className="form-title-icon" />
                <h3>Add User</h3>
              </div>
              <form onSubmit={handleCreateUser} className="settings-form">
                <div className="settings-form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="name@domain.com"
                    required
                  />
                </div>
                <div className="settings-form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Enter security password"
                    required
                  />
                </div>
                <div className="settings-form-group">
                  <label>Role</label>
                  <select value={userRole} onChange={(e) => setUserRole(e.target.value)}>
                    <option value="user">User</option>
                    <option value="admin">Administrator</option>
                    <option value="group_admin">Group Administrator</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div className="settings-form-group">
                  <label>Default Group Allocation</label>
                  <select value={userGroup} onChange={(e) => setUserGroup(e.target.value)}>
                    {groups.length === 0 ? (
                      <option value="Public">Public</option>
                    ) : (
                      groups.map((g) => (
                        <option key={g.id} value={g.name}>{g.name}</option>
                      ))
                    )}
                  </select>
                </div>
                <button type="submit" className="settings-submit-btn" disabled={creatingUser}>
                  {creatingUser ? 'Provisioning...' : 'Provision Account'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ─── GROUPS VIEW ─── */}
        {activeSubTab === 'groups' && (
          <div className="settings-grid-layout">
            <div className="settings-main-card">
              <div className="card-header-bar">
                <h3>Logical Access Scopes</h3>
                <span className="count-badge">{groups.length} groups</span>
              </div>
              {loadingGroups ? (
                <div className="settings-spinner-wrapper"><span className="settings-spinner"></span></div>
              ) : (
                <div className="settings-table-wrapper">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Group Name</th>
                        <th>Description</th>
                        <th>Group Admin</th>
                        <th>Expiration Date</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="empty-table-state">
                            <Database size={24} />
                            <p>No logical access groups found.</p>
                          </td>
                        </tr>
                      ) : (
                        groups.map((g) => {
                          const expired = isGroupExpired(g);
                          return (
                            <tr key={g.id}>
                              <td>
                                <strong className="group-name-text">{g.name}</strong>
                              </td>
                              <td className="desc-col">{g.description || '—'}</td>
                              <td>
                                <span className="group-admin-badge">
                                  {g.admin_email ? `👑 ${g.admin_email}` : (g.name === 'Public' ? 'Global' : 'Super Admin')}
                                </span>
                              </td>
                              <td>
                                <span className="expiry-display">
                                  <Calendar size={13} className="cell-icon" />
                                  <span>{formatDate(g.expires_at)}</span>
                                </span>
                              </td>
                              <td>
                                <span className={`status-badge ${expired ? 'expired' : 'active'}`}>
                                  {expired ? 'Expired' : 'Active'}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="settings-action-btn danger-icon"
                                  onClick={() => handleDeleteGroup(g.id, g.name)}
                                  disabled={g.name === 'Public'}
                                  title={g.name === 'Public' ? 'Default group is protected' : 'Delete Group'}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="settings-side-card">
              <div className="form-card-header">
                <FolderPlus size={18} className="form-title-icon" />
                <h3>Create Group</h3>
              </div>
              <form onSubmit={handleCreateGroup} className="settings-form">
                <div className="settings-form-group">
                  <label>Group Name</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. QA-Automators"
                    required
                  />
                </div>
                <div className="settings-form-group">
                  <label>Description</label>
                  <textarea
                    value={groupDesc}
                    onChange={(e) => setGroupDesc(e.target.value)}
                    placeholder="Logical scope definition"
                    rows="3"
                  />
                </div>
                <div className="settings-form-group">
                  <label>Designated Group Admin</label>
                  <select value={groupAdminId} onChange={(e) => setGroupAdminId(e.target.value)}>
                    <option value="">None (Super Admin only)</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
                    ))}
                  </select>
                  <small className="help-text">Assumes admin privileges only for this group and its devices</small>
                </div>
                <div className="settings-form-group">
                  <label>Access Expiration</label>
                  <input
                    type="datetime-local"
                    value={groupExpiry}
                    onChange={(e) => setGroupExpiry(e.target.value)}
                  />
                  <small className="help-text">Leave blank for infinite access lifespans</small>
                </div>
                <button type="submit" className="settings-submit-btn" disabled={creatingGroup}>
                  {creatingGroup ? 'Creating Group...' : 'Initialize Group'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ─── ALLOCATIONS VIEW ─── */}
        {activeSubTab === 'allocations' && (
          <div className="allocations-container">
            <div className="group-selection-card">
              <div className="selector-wrap">
                <label>Target Group Scope:</label>
                <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                  <option value="">-- Choose Group --</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} {isGroupExpired(g) ? '(⚠️ Expired)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {selectedGroupId && (
                <div className="active-group-indicator">
                  <CheckCircle size={14} />
                  <span>Configuring permissions for {groups.find(g => g.id === selectedGroupId)?.name}</span>
                </div>
              )}
            </div>

            {selectedGroupId ? (
              <div className="allocations-subgrid">
                {/* Users Allocation */}
                <div className="allocation-card">
                  <div className="card-header-bar">
                    <h4>Mapped Users</h4>
                    <span className="count-pill">{groupUsers.length}</span>
                  </div>
                  
                  {loadingAllocations ? (
                    <div className="settings-spinner-wrapper"><span className="settings-spinner"></span></div>
                  ) : (
                    <>
                      <div className="allocation-list-wrap">
                        {groupUsers.length === 0 ? (
                          <div className="empty-allocation-li">
                            <AlertCircle size={18} />
                            <p>No members mapped to this group scope yet.</p>
                          </div>
                        ) : (
                          <div className="alloc-list-inner">
                            {groupUsers.map((u) => (
                              <div key={u.id} className="allocation-list-item">
                                <div className="alloc-item-info">
                                  <Mail size={14} className="cell-icon" />
                                  <span>{u.email}</span>
                                </div>
                                <button
                                  className="alloc-remove-btn"
                                  onClick={() => handleRemoveUserFromGroup(u.id)}
                                  title="Revoke Group Membership"
                                >
                                  <UserMinus size={13} />
                                  <span>Revoke</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <form onSubmit={handleAddUserToGroup} className="allocation-form">
                        <select
                          value={allocateUserId}
                          onChange={(e) => setAllocateUserId(e.target.value)}
                          required
                        >
                          <option value="">Select user to add...</option>
                          {users
                            .filter((u) => !groupUsers.some((gu) => gu.id === u.id))
                            .map((u) => (
                              <option key={u.id} value={u.id}>{u.email}</option>
                            ))}
                        </select>
                        <button type="submit" className="add-btn">
                          <span>Map Member</span>
                        </button>
                      </form>
                    </>
                  )}
                </div>

                {/* Devices Allocation */}
                <div className="allocation-card">
                  <div className="card-header-bar">
                    <h4>Allocated Hardware</h4>
                    <span className="count-pill">{groupDeviceSerials.length}</span>
                  </div>

                  {loadingAllocations ? (
                    <div className="settings-spinner-wrapper"><span className="settings-spinner"></span></div>
                  ) : (
                    <>
                      <div className="allocation-list-wrap">
                        {groupDeviceSerials.length === 0 ? (
                          <div className="empty-allocation-li">
                            <Smartphone size={18} />
                            <p>No smartphone hardware mapped to this scope.</p>
                          </div>
                        ) : (
                          <div className="alloc-list-inner">
                            {groupDeviceSerials.map((item) => {
                              const serial = typeof item === 'string' ? item : item.serial;
                              const assignedUserId = typeof item === 'object' ? item.allocated_to_user_id : null;
                              const d = allDevices.find((dev) => dev.serial === serial);
                              return (
                                <div key={serial} className="allocation-list-item allocation-device-item">
                                  <div className="alloc-item-info">
                                    <Smartphone size={14} className="cell-icon" />
                                    <div className="alloc-device-text">
                                      <span className="dev-name">{d ? `${d.manufacturer} ${d.model}` : 'Hardware Endpoint'}</span>
                                      <small className="serial-meta">{serial}</small>
                                    </div>
                                  </div>

                                  {/* Direct Member Assignment Dropdown */}
                                  <div className="alloc-member-assignment">
                                    <select
                                      value={assignedUserId || ''}
                                      onChange={(e) => handleAssignDeviceToUser(serial, e.target.value)}
                                      className="device-assign-dropdown"
                                      title="Assign this device to a specific group member"
                                    >
                                      <option value="">👥 Shared (All Group Members)</option>
                                      {groupUsers.map((u) => (
                                        <option key={u.id} value={u.id}>
                                          👤 Only: {u.email}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {isSuperAdmin && (
                                    <button
                                      className="alloc-remove-btn"
                                      onClick={() => handleRemoveDeviceFromGroup(serial)}
                                      title="Deallocate device from group"
                                    >
                                      <UserMinus size={13} />
                                      <span>Revoke</span>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {isSuperAdmin ? (
                        <form onSubmit={handleAddDeviceToGroup} className="allocation-form">
                          <select
                            value={allocateSerial}
                            onChange={(e) => setAllocateSerial(e.target.value)}
                            required
                          >
                            <option value="">Select device from fleet to allocate...</option>
                            {allDevices
                              .filter((d) => !groupDeviceSerials.some((item) => (typeof item === 'string' ? item : item.serial) === d.serial))
                              .map((d) => (
                                <option key={d.serial} value={d.serial}>
                                  {d.manufacturer} {d.model} ({d.serial})
                                </option>
                              ))}
                          </select>
                          <button type="submit" className="add-btn">
                            <span>Allocate to Group</span>
                          </button>
                        </form>
                      ) : (
                        <div className="group-admin-notice">
                          <ShieldAlert size={15} />
                          <span>Hardware devices are allocated to groups by the Super Admin (sammyseth260@gmail.com). As Group Admin, you can assign the hardware devices above to specific group members.</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="group-unselected-state">
                <Database size={40} />
                <h4>No Scope Selected</h4>
                <p>Please choose a target group scope above to adjust user memberships and allocate hardware endpoints.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPanel;
