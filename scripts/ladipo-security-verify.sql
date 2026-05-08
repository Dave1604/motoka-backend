-- Ladipo security verification (run in Supabase SQL Editor against your project)
-- From ladiposecurityaudit.md — Phases 4A, 4D + manual IDOR reminders

-- 1) Tables in public with RLS disabled (should return NO ladipo_* rows after migrations)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;

-- 2) Confirm Ladipo tables have RLS on
SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname LIKE 'ladipo%'
ORDER BY c.relname;

-- 3) Anonymous cannot read other users' orders (expect 0 rows)
SET ROLE anon;
SELECT count(*) AS anon_order_rows FROM public.ladipo_orders;
RESET ROLE;

-- 4) Manual checks (not runnable here)
--    IDOR: Log in as User A, note an order_number. Log in as User B, GET /api/ladipo/orders/:orderNumber
--    with B's token → expect 404.
--    Webhook: POST /api/webhooks/paystack with JSON body and no x-paystack-signature → expect 401.
