-- =============================================
-- SECURE PAYMENT FLOW
-- Migration 019: Idempotency and atomic payment processing
-- =============================================

-- Ensure one order per payment transaction
ALTER TABLE public.renewal_orders
  ADD CONSTRAINT renewal_orders_transaction_unique UNIQUE (transaction_id);

-- Optional: ensure a car can only have one pending/processing order at a time
-- This prevents multiple in-flight renewals for the same car.
CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_orders_car_pending_unique
  ON public.renewal_orders (car_id)
  WHERE status IN ('pending', 'processing');

-- Atomic function to mark payment successful and create order if missing
-- Returns the transaction and order IDs for further processing.
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
  p_metadata JSONB
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
    -- Either not found or already processed
    SELECT * INTO v_tx
    FROM public.payment_transactions
    WHERE reference = p_reference
    LIMIT 1;

    RETURN QUERY SELECT v_tx.id, NULL::BIGINT, TRUE;
    RETURN;
  END IF;

  -- Create order if missing
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
    COALESCE(p_metadata, '{}'::jsonb)
  FROM public.cars c
  WHERE c.id = v_tx.car_id
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_tx.id, v_order_id, FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
