-- Supabase hardening for the Protean device farm.
--
-- Supabase auto-exposes every table in the `public` schema through PostgREST
-- (the auto-generated REST API) to anyone holding the anon key. Several farm
-- tables hold secrets that must not be readable that way:
--   users    → bcrypt password hashes, roles
--   api_keys → SHA-256 token hashes
--   sessions → who claimed what, and when
--
-- Run this ONCE in the Supabase Dashboard → SQL Editor after the coordinator
-- has created the schema (i.e. after its first successful start).
--
-- The coordinator connects with the postgres (superuser) role over the
-- session pooler, so revoking the anon/authenticated roles does not affect it.

-- 1. Block anonymous and Supabase-authenticated REST access to sensitive tables.
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.api_keys FROM anon, authenticated;
REVOKE ALL ON TABLE public.sessions FROM anon, authenticated;

-- 2. Defense in depth: keep the broader farm tables read-only-proof as well.
--    (Providers/devices/scripts/reports are not secret, but there is no reason
--    for PostgREST to serve them either — the coordinator API is the front door.)
REVOKE ALL ON TABLE public.providers FROM anon, authenticated;
REVOKE ALL ON TABLE public.devices FROM anon, authenticated;
REVOKE ALL ON TABLE public.device_groups FROM anon, authenticated;
REVOKE ALL ON TABLE public.groups FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_groups FROM anon, authenticated;
REVOKE ALL ON TABLE public.automation_scripts FROM anon, authenticated;
REVOKE ALL ON TABLE public.automation_reports FROM anon, authenticated;

-- 3. Revoke default privileges for future objects created by postgres in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

-- 4. Explicitly allow public reading and tunnel updating of farm_config table
GRANT SELECT, INSERT, UPDATE ON TABLE public.farm_config TO anon, authenticated;

-- 4. Verify: both queries should return zero rows.
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
