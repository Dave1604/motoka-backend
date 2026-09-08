-- Migration 098: enable RLS on payment_idempotency and payment_audit_log.
--
-- Migration 038 created both tables without ENABLE ROW LEVEL SECURITY, which
-- left them wide open through PostgREST: anyone with the (public, bundled)
-- anon key could read the payment audit log and insert idempotency keys to
-- make real checkouts 409 as duplicates. Flagged by the Supabase Security
-- Advisor on 2026-09-08 and applied to prod the same day via the Management
-- API — this file records it for rebuilds.
--
-- No policies on purpose: only the backend touches these tables, and it uses
-- the service role, which bypasses RLS. RLS-on with zero policies means
-- "backend only".

ALTER TABLE public.payment_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
