-- =========================================================================
-- FLEXPULSE SAFE INCREMENTAL MIGRATION
-- Run this in Supabase SQL Editor if tables already exist.
-- Every statement uses IF NOT EXISTS or safe exception handling.
-- =========================================================================

-- 1. Add admin_id to groups table (for Designated Group Admin)
ALTER TABLE IF EXISTS public.groups 
    ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Add allocated_to_user_id to device_groups table (for per-user device assignment)
ALTER TABLE IF EXISTS public.device_groups 
    ADD COLUMN IF NOT EXISTS allocated_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 3. Create farm_config table if not present (stores dynamic Cloudflare tunnel URL)
CREATE TABLE IF NOT EXISTS public.farm_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. Enable Realtime Replication safely (idempotent, won't fail if already enabled)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.farm_config;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_groups;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

-- 5. Safe Permissions & Grants
GRANT SELECT ON TABLE public.devices TO anon, authenticated;
GRANT SELECT ON TABLE public.groups TO anon, authenticated;
GRANT SELECT ON TABLE public.device_groups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.farm_config TO anon, authenticated;

-- 6. Ensure Public default group exists
INSERT INTO public.groups (id, name, description, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Public', 'Default public group for unauthenticated or general users', NOW())
ON CONFLICT (id) DO NOTHING;

-- Migration complete!
