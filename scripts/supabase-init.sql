-- ===================================================================
-- FlexPulse Device Farm - Complete Supabase Initialization Script
-- Run this in the Supabase Dashboard -> SQL Editor
-- It creates all required tables, relationships, default groups,
-- and configures security permissions and realtime synchronization.
-- ===================================================================

-- 1. Providers Table (Host Daemons connected to physical devices)
CREATE TABLE IF NOT EXISTS public.providers (
    ip TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    min_port INT NOT NULL,
    max_port INT NOT NULL,
    version TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. Devices Table (Smartphones and Tablets)
CREATE TABLE IF NOT EXISTS public.devices (
    serial TEXT PRIMARY KEY,
    provider_ip TEXT NOT NULL REFERENCES public.providers(ip) ON DELETE CASCADE,
    model TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    sdk INT NOT NULL,
    abi TEXT NOT NULL,
    ram_mb BIGINT NOT NULL,
    storage_mb BIGINT NOT NULL,
    display_width INT NOT NULL,
    display_height INT NOT NULL,
    display_dpi INT NOT NULL,
    battery INT NOT NULL,
    wifi_ssid TEXT NOT NULL,
    ip TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    stream_port INT NOT NULL DEFAULT 0,
    platform TEXT NOT NULL DEFAULT 'android',
    os_version TEXT NOT NULL DEFAULT '',
    file_system JSON,
    installed_browsers JSON,
    connected_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Sessions Table (Device Claims and Leases)
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY,
    serial TEXT NOT NULL REFERENCES public.devices(serial) ON DELETE CASCADE,
    claimed_by TEXT NOT NULL,
    claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    released_at TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'active',
    user_id UUID
);

-- 4. Users Table (Farm Accounts & Supabase Auth Mapping)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    auth_provider TEXT NOT NULL DEFAULT 'supabase',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 5. Groups Table (Group-Based Tenancy & Device Allocation)
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 6. User-Groups Table (User Memberships)
CREATE TABLE IF NOT EXISTS public.user_groups (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);

-- 7. Device-Groups Table (Device Allocation to Groups)
CREATE TABLE IF NOT EXISTS public.device_groups (
    serial TEXT NOT NULL REFERENCES public.devices(serial) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    allocated_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    PRIMARY KEY (serial, group_id)
);

-- 8. Automation Scripts & Reports
CREATE TABLE IF NOT EXISTS public.automation_scripts (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.automation_reports (
    id UUID PRIMARY KEY,
    script_id UUID REFERENCES public.automation_scripts(id) ON DELETE CASCADE,
    serial TEXT NOT NULL REFERENCES public.devices(serial) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    results JSON NOT NULL
);

-- 9. API Keys
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP
);

-- 10. Farm Configuration Table (Dynamic Stream Tunnel URL Sync)
CREATE TABLE IF NOT EXISTS public.farm_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Insert Default Public Group
INSERT INTO public.groups (id, name, description, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Public', 'Default public device group', NOW())
ON CONFLICT (name) DO NOTHING;

-- Initialize default tunnel_url row
INSERT INTO public.farm_config (key, value)
VALUES ('tunnel_url', '')
ON CONFLICT (key) DO NOTHING;

-- Enable Realtime for farm_config so Netlify automatically gets new tunnel URLs
ALTER PUBLICATION supabase_realtime ADD TABLE public.farm_config;

-- ===================================================================
-- Security & Permissions (Hardening)
-- ===================================================================

-- Block anonymous access to sensitive tables (passwords, keys, sessions)
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.api_keys FROM anon, authenticated;
REVOKE ALL ON TABLE public.sessions FROM anon, authenticated;

-- Allow reading public device lists and groups
GRANT SELECT ON TABLE public.devices TO anon, authenticated;
GRANT SELECT ON TABLE public.groups TO anon, authenticated;
GRANT SELECT ON TABLE public.device_groups TO anon, authenticated;

-- Allow public reading and updating of active tunnel URL
GRANT SELECT, INSERT, UPDATE ON TABLE public.farm_config TO anon, authenticated;

-- Revoke default privileges for future tables created by postgres in public schema
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;

-- Finished!
