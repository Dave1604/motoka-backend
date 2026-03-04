-- =============================================
-- Migration 043: Nuclear cleanup of all dev/test transactions
-- Keeps ONLY rakiorasak's real transaction PAY-MMAS5Q4Y-815809B8
-- Then creates the missing renewal order for that transaction.
-- =============================================

-- STEP 1: Delete ALL audit log entries (dev/test data)
DELETE FROM public.payment_audit_log;

-- STEP 2: Delete ALL renewal orders (dev/test orders)
DELETE FROM public.renewal_orders;

-- STEP 3: Delete ALL payment transactions EXCEPT rakiorasak's real one
DELETE FROM public.payment_transactions
WHERE reference != 'PAY-MMAS5Q4Y-815809B8';

-- STEP 4: Reset ALL cars that are 'approved' back to 'unpaid'
-- except for cars that have a valid payment (none after step 3, so all reset)
UPDATE public.cars
SET status = 'unpaid', updated_at = NOW()
WHERE status = 'approved';

-- STEP 5: Create the missing renewal order for rakiorasak's successful payment
DO $$
DECLARE
  v_tx           public.payment_transactions;
  v_car_id       BIGINT;
  v_car_slug     TEXT;
  v_order_exists BOOLEAN;
BEGIN
  -- Fetch the real transaction
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE reference = 'PAY-MMAS5Q4Y-815809B8'
  LIMIT 1;

  IF v_tx IS NULL THEN
    RAISE NOTICE 'Transaction PAY-MMAS5Q4Y-815809B8 not found — skipping order creation.';
    RETURN;
  END IF;

  -- Check if an order already exists for this transaction
  SELECT EXISTS (
    SELECT 1 FROM public.renewal_orders WHERE transaction_id = v_tx.id
  ) INTO v_order_exists;

  IF v_order_exists THEN
    RAISE NOTICE 'Order already exists for this transaction — skipping.';
    RETURN;
  END IF;

  -- Get the car_id from the transaction
  v_car_id := v_tx.car_id;

  -- Create the renewal order
  INSERT INTO public.renewal_orders (
    order_number,
    user_id,
    car_id,
    transaction_id,
    order_type,
    status,
    amount_paid,
    currency,
    renewal_months,
    selected_items,
    renewal_amount,
    delivery_fee,
    metadata
  ) VALUES (
    public.generate_order_number(),
    v_tx.user_id,
    v_car_id,
    v_tx.id,
    'renewal_manual',
    'pending',
    v_tx.amount,
    COALESCE(v_tx.currency, 'NGN'),
    12,
    COALESCE(v_tx.metadata->'selected_items', '[]'::jsonb),
    v_tx.amount,
    0,
    COALESCE(v_tx.metadata, '{}'::jsonb)
  );

  -- Update the car status to 'approved' (payment confirmed)
  IF v_car_id IS NOT NULL THEN
    UPDATE public.cars
    SET status = 'approved', updated_at = NOW()
    WHERE id = v_car_id;
    
    SELECT slug INTO v_car_slug FROM public.cars WHERE id = v_car_id;
    RAISE NOTICE 'Car % (id=%) status set to approved.', v_car_slug, v_car_id;
  END IF;

  RAISE NOTICE 'Renewal order created for rakiorasak transaction PAY-MMAS5Q4Y-815809B8.';
END $$;
