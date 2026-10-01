-- =========================================================================
-- FLEXPULSE SAFE INCREMENTAL MIGRATION FOR DIRECT CLOUD / NETLIFY ACCESS
-- =========================================================================

-- 1. Ensure columns exist for Group Admin and device allocation
ALTER TABLE IF EXISTS public.groups 
    ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.device_groups 
    ADD COLUMN IF NOT EXISTS allocated_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Create farm_config table if not present (stores dynamic Cloudflare tunnel URL)
CREATE TABLE IF NOT EXISTS public.farm_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Automatic Profile Synchronization Trigger (Supabase Auth -> public.users)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.users (id, email, role, auth_provider, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        CASE WHEN LOWER(NEW.email) = 'sammyseth260@gmail.com' THEN 'admin' ELSE 'user' END,
        'supabase',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE 
    SET email = EXCLUDED.email,
        role = CASE WHEN LOWER(EXCLUDED.email) = 'sammyseth260@gmail.com' THEN 'admin' ELSE public.users.role END,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Backfill any users already in auth.users into public.users
INSERT INTO public.users (id, email, role, auth_provider, created_at, updated_at)
SELECT 
    id, 
    email, 
    CASE WHEN LOWER(email) = 'sammyseth260@gmail.com' THEN 'admin' ELSE 'user' END,
    'supabase',
    created_at,
    NOW()
FROM auth.users
ON CONFLICT (id) DO UPDATE 
SET email = EXCLUDED.email,
    role = CASE WHEN LOWER(EXCLUDED.email) = 'sammyseth260@gmail.com' THEN 'admin' ELSE public.users.role END;

-- 5. Full Grants for Netlify direct cloud access (Authentication, Users, Groups, Devices)
GRANT ALL ON TABLE public.users TO anon, authenticated;
GRANT ALL ON TABLE public.groups TO anon, authenticated;
GRANT ALL ON TABLE public.user_groups TO anon, authenticated;
GRANT ALL ON TABLE public.device_groups TO anon, authenticated;
GRANT ALL ON TABLE public.devices TO anon, authenticated;
GRANT ALL ON TABLE public.farm_config TO anon, authenticated;

-- Ensure RLS is disabled on these tables so frontend client queries proceed cleanly
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_config DISABLE ROW LEVEL SECURITY;

-- 6. Enable Realtime Replication safely (idempotent)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.farm_config;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_groups;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

-- 7. Ensure Public default group exists
INSERT INTO public.groups (id, name, description, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Public', 'Default public device group', NOW())
ON CONFLICT (id) DO NOTHING;

-- Migration complete!
