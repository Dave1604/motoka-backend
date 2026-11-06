-- MIGRATION 122 – Close direct database access to money and admin rights
--
-- The website ships the public anon key, and every signed-in customer holds a
-- valid token, so both can call the database's REST API directly. Two holes:
--
-- 1. Migration 053 revoked UPDATE on profiles.is_admin column by column, but a
--    table-wide UPDATE grant overrides column revokes, so any customer could set
--    is_admin on their own row and pass the admin check.
-- 2. On Supabase, functions in `public` are executable by anon and authenticated
--    by default. SECURITY DEFINER functions ignore row security, so anyone could
--    call wallet_credit, wallet_admin_adjust or process_payment_success.
--
-- The backend uses the service role, which is unaffected. Triggers and pg_cron do
-- not need these grants: a trigger's function is not permission-checked when it
-- fires, and cron jobs run as the owner.

-- ── 1. Customers may only edit their own contact details ───────────────────
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (first_name, last_name, phone_number, image, address, gender, updated_at)
  ON public.profiles TO authenticated;

-- ── 2. SECURITY DEFINER functions are for the backend only ─────────────────
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND p.prosecdef AND d.objid IS NULL
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ── 3. New functions start closed, so this cannot quietly come back ────────
-- A function that must be public now needs its own explicit GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
