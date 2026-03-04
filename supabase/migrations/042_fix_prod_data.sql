-- =============================================
-- Migration 042: Fix production data
-- 1. Reset dev test cars from 'approved' back to 'unpaid'
--    (padewara12, payomide14, trymotoka, sulaimon bello cars were approved
--     during development testing, not through real payments)
-- 2. Delete extra pending duplicate transactions for rakiorasak
-- =============================================

DO $$
DECLARE
  test_user_ids UUID[];
BEGIN
  -- Collect test user IDs by email pattern
  SELECT ARRAY_AGG(id) INTO test_user_ids
  FROM auth.users
  WHERE email ILIKE '%padewara12%'
     OR email ILIKE '%payomide14%'
     OR email ILIKE '%trymotoka%'
     OR email ILIKE '%sulaimon%'
     OR email ILIKE '%olamoney665%';

  IF test_user_ids IS NULL OR array_length(test_user_ids, 1) = 0 THEN
    RAISE NOTICE 'No test users found — skipping car status reset.';
  ELSE
    -- Reset test user cars back to 'unpaid' (they were approved during dev testing only)
    UPDATE public.cars
    SET status = 'unpaid', updated_at = NOW()
    WHERE user_id = ANY(test_user_ids)
      AND status = 'approved';

    RAISE NOTICE 'Reset % test user car(s) to unpaid.', (
      SELECT COUNT(*) FROM public.cars
      WHERE user_id = ANY(test_user_ids)
    );
  END IF;
END $$;

-- Delete the 3 extra/duplicate PENDING transactions for rakiorasak
-- (only the one successful payment PAY-MMAS5Q4Y-815809B8 should remain)
DO $$
DECLARE
  rakio_user_id UUID;
BEGIN
  SELECT id INTO rakio_user_id
  FROM auth.users
  WHERE email ILIKE '%rakiorasak%'
  LIMIT 1;

  IF rakio_user_id IS NULL THEN
    RAISE NOTICE 'rakiorasak user not found — skipping duplicate transaction cleanup.';
    RETURN;
  END IF;

  -- Delete pending duplicate transactions, keeping only the successful one
  DELETE FROM public.payment_transactions
  WHERE user_id = rakio_user_id
    AND status = 'pending';

  RAISE NOTICE 'Deleted pending duplicate transactions for rakiorasak.';
END $$;
