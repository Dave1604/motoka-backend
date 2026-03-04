-- =============================================
-- Migration 041: Cleanup dev/test payment data + add description to documents
-- =============================================

-- 1. Add description column to documents table
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Delete dev/test payment data
-- Identifies test users by email patterns and removes their payment history
-- while KEEPING their profiles and cars (real users/vehicles).
-- Test users: padewara12, payomide14, trymotoka, and sulaimon bello patterns.

DO $$
DECLARE
  test_user_ids UUID[];
BEGIN
  -- Collect UUIDs of test/dev users from auth.users by email patterns
  SELECT ARRAY_AGG(id) INTO test_user_ids
  FROM auth.users
  WHERE
    email ILIKE '%padewara12%'
    OR email ILIKE '%payomide14%'
    OR email ILIKE '%trymotoka%'
    OR email ILIKE '%sulaimon%'
    OR email ILIKE '%payomide%';  -- catch variants

  IF test_user_ids IS NULL OR array_length(test_user_ids, 1) = 0 THEN
    RAISE NOTICE 'No test users found — skipping data deletion.';
    RETURN;
  END IF;

  RAISE NOTICE 'Found % test user(s) to clean up', array_length(test_user_ids, 1);

  -- Delete payment audit log entries
  DELETE FROM public.payment_audit_log
  WHERE user_id = ANY(test_user_ids);

  -- Delete renewal orders
  DELETE FROM public.renewal_orders
  WHERE user_id = ANY(test_user_ids);

  -- Delete payment transactions
  DELETE FROM public.payment_transactions
  WHERE user_id = ANY(test_user_ids);

  -- Note: cars.status (unpaid|pending|approved|rejected) doesn't store renewal_pending
  -- because "Renewal in Progress" is a calculated display status derived from pending
  -- renewal_orders. Deleting those orders above is sufficient to clear it.

  RAISE NOTICE 'Dev data cleaned up successfully.';
END $$;
