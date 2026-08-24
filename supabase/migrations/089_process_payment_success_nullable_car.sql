-- Restore driver-license (and other car-less) order creation.
-- Migration 085 inserted FROM cars WHERE id = car_id, so a NULL car_id
-- created no renewal_orders row after a successful payment.

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
  v_previous_expiry DATE;
BEGIN
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

  IF v_tx.car_id IS NOT NULL THEN
    SELECT c.expiry_date INTO v_previous_expiry
    FROM public.cars c
    WHERE c.id = v_tx.car_id
    LIMIT 1;
  ELSE
    v_previous_expiry := NULL;
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
    v_previous_expiry,
    COALESCE(p_selected_items, '[]'::jsonb),
    COALESCE(p_renewal_amount, v_tx.amount),
    COALESCE(p_delivery_fee, 0),
    p_delivery_address,
    p_delivery_state,
    p_delivery_lga,
    p_delivery_contact,
    COALESCE(p_renewal_state, v_tx.metadata->>'renewal_state'),
    COALESCE(p_metadata, '{}'::jsonb)
  FROM (SELECT 1) AS single
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
'Atomically processes payment success. Creates an order even when car_id is NULL (driver license). ON CONFLICT uses the constraint name to avoid RETURNS TABLE transaction_id ambiguity.';
