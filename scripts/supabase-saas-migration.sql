-- =========================================================================
-- SAAS MULTI-TENANT MIGRATION: PLATFORM ID, HOST MACHINE SCOPING & USER SUSPENSION
-- =========================================================================

-- 1. Add platform_id, created_by, and status to users table
ALTER TABLE IF EXISTS public.users
    ADD COLUMN IF NOT EXISTS platform_id TEXT,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 2. Add platform_id and allocated_to_user_id to devices table
ALTER TABLE IF EXISTS public.devices
    ADD COLUMN IF NOT EXISTS platform_id TEXT,
    ADD COLUMN IF NOT EXISTS allocated_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 3. Update automatic profile sync trigger to record created_by and platform_id metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_created_by UUID := NULL;
    v_platform_id TEXT := NULL;
    v_role TEXT := 'user';
BEGIN
    -- Extract optional creator metadata (when admin creates sub-user)
    IF (NEW.raw_user_meta_data->>'created_by') IS NOT NULL AND (NEW.raw_user_meta_data->>'created_by') != '' THEN
        v_created_by := (NEW.raw_user_meta_data->>'created_by')::UUID;
    END IF;

    -- Extract optional platform_id metadata
    IF (NEW.raw_user_meta_data->>'platform_id') IS NOT NULL THEN
        v_platform_id := NEW.raw_user_meta_data->>'platform_id';
    END IF;

    -- Determine role: Super Admin is always 'admin'; users created by admins are 'user'; independent signups can be 'admin'
    IF LOWER(NEW.email) = 'sammyseth260@gmail.com' THEN
        v_role := 'admin';
    ELSIF v_created_by IS NOT NULL THEN
        v_role := 'user';
    ELSE
        -- Independent signup (Farm Owner / Admin)
        v_role := 'admin';
    END IF;

    INSERT INTO public.users (id, email, role, platform_id, created_by, status, auth_provider, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        v_role,
        v_platform_id,
        v_created_by,
        'active',
        'supabase',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE 
    SET email = EXCLUDED.email,
        role = CASE WHEN LOWER(EXCLUDED.email) = 'sammyseth260@gmail.com' THEN 'admin' ELSE public.users.role END,
        platform_id = COALESCE(public.users.platform_id, EXCLUDED.platform_id),
        created_by = COALESCE(public.users.created_by, EXCLUDED.created_by),
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Ensure super admin is always active admin
UPDATE public.users 
SET role = 'admin', status = 'active' 
WHERE LOWER(email) = 'sammyseth260@gmail.com';

-- Ensure all permissions and realtime replication
GRANT ALL ON TABLE public.users TO anon, authenticated;
GRANT ALL ON TABLE public.devices TO anon, authenticated;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;
