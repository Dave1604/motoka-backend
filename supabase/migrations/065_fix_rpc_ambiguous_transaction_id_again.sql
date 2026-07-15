-- Migration 065: re-fix ambiguous `transaction_id` in process_payment_success()
--
-- Regression history:
--   025 fixed "column reference transaction_id is ambiguous" by switching the
--       INSERT ... ON CONFLICT target from the bare column `(transaction_id)` to
--       the constraint name `ON CONFLICT ON CONSTRAINT renewal_orders_transaction_unique`.
--   036 preserved that constraint-name form.
--   051 (add renewal_state) REGRESSED it back to `ON CONFLICT (transaction_id)`,
--       reintroducing the ambiguity: the function's `RETURNS TABLE (transaction_id
--       BIGINT, ...)` output column collides with renewal_orders.transaction_id in
--       the conflict target, so every success-path call raises 42702 and the order
--       is never created.
--
-- Impact: this RPC is the shared success path for BOTH Paystack and Monicredit
-- (webhook + verify). While 051 was deployed, no renewal order could be created
-- on payment success for either gateway.
--
-- Fix: recreate the function exactly as 051 (keeps renewal_state) but with the
-- constraint-name ON CONFLICT form that 025/036 used. The unique constraint
-- `renewal_orders_transaction_unique UNIQUE (transaction_id)` is created in 019.

CREATE OR REPLACE FUNCTION public.process_payment_success(
  p_reference VARCHAR,
  p_status payment_status,
  p_channel VARCHAR,
  p_authorization_code VARCHAR,
  p_paid_at TIMESTAMPTZ,
  p_order_type order_type,
  p_renewal_months INTEGER,
  p_selected_items JSONB,
  p_renewal_amount NUMERIC,
  p_delivery_fee NUMERIC,
  p_delivery_address TEXT,
  p_delivery_state TEXT,
  p_delivery_lga TEXT,
  p_delivery_contact TEXT,
  p_metadata JSONB,
  p_renewal_state TEXT DEFAULT NULL
)
RETURNS TABLE (
  transaction_id BIGINT,
  order_id BIGINT,
  already_processed BOOLEAN
) AS $$
DECLARE
  v_tx public.payment_transactions;
  v_order_id BIGINT;
BEGIN
  -- Lock and update only if still pending
  UPDATE public.payment_transactions
    SET status = p_status,
        channel = p_channel,
        authorization_code = p_authorization_code,
        paid_at = p_paid_at,
        updated_at = NOW()
  WHERE reference = p_reference
    AND status = 'pending'
  RETURNING * INTO v_tx;

  IF NOT FOUND THEN
    SELECT * INTO v_tx
    FROM public.payment_transactions
    WHERE reference = p_reference
    LIMIT 1;

    RETURN QUERY SELECT v_tx.id, NULL::BIGINT, TRUE;
    RETURN;
  END IF;

  INSERT INTO public.renewal_orders (
    order_number,
    user_id,
    car_id,
    transaction_id,
    subscription_id,
    order_type,
    status,
    amount_paid,
    currency,
    renewal_months,
    previous_expiry_date,
    selected_items,
    renewal_amount,
    delivery_fee,
    delivery_address,
    delivery_state,
    delivery_lga,
    delivery_contact,
    renewal_state,
    metadata
  )
  SELECT
    public.generate_order_number(),
    v_tx.user_id,
    v_tx.car_id,
    v_tx.id,
    (v_tx.metadata->>'subscription_id')::BIGINT,
    p_order_type,
    'pending',
    v_tx.amount,
    v_tx.currency,
    COALESCE(p_renewal_months, 12),
    c.expiry_date,
    COALESCE(p_selected_items, '[]'::jsonb),
    COALESCE(p_renewal_amount, v_tx.amount),
    COALESCE(p_delivery_fee, 0),
    p_delivery_address,
    p_delivery_state,
    p_delivery_lga,
    p_delivery_contact,
    COALESCE(p_renewal_state, v_tx.metadata->>'renewal_state'),
    COALESCE(p_metadata, '{}'::jsonb)
  FROM public.cars c
  WHERE c.id = v_tx.car_id
  ON CONFLICT ON CONSTRAINT renewal_orders_transaction_unique DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_tx.id IS NOT NULL AND v_tx.car_id IS NOT NULL AND p_status = 'successful' THEN
    UPDATE public.cars
    SET status = 'approved',
        updated_at = NOW()
    WHERE id = v_tx.car_id;
  END IF;

  RETURN QUERY SELECT v_tx.id, v_order_id, FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.process_payment_success IS
'Atomically processes payment success: updates transaction status, creates order, and updates car status. Stores renewal_state alongside delivery details. ON CONFLICT uses the constraint name (not the bare column) to avoid ambiguity with the RETURNS TABLE transaction_id output column — see migration 065.';
