-- ============================================================
-- MIGRATION 080 – Wallet system (Phase 2: pay-with-wallet)
-- ============================================================
-- pay_with_wallet() debits the wallet AND fulfills the order in a SINGLE
-- transaction, so money can never leave the wallet without an order being
-- created. It reuses the existing process_payment_success() success path
-- unchanged (the same path Paystack/Monicredit use) — if that raises, the whole
-- transaction (including the debit) rolls back. No compensation window.
--
-- Idempotent: a debit ledger row for the reference means it's already paid, so a
-- retry re-runs only the (idempotent) fulfillment and does not double-debit.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pay_with_wallet(
  p_user_id          UUID,
  p_reference        VARCHAR,
  p_amount_kobo      BIGINT,
  p_transaction_id   BIGINT,
  p_order_type       order_type,
  p_renewal_months   INTEGER,
  p_selected_items   JSONB,
  p_renewal_amount   NUMERIC,
  p_delivery_fee     NUMERIC,
  p_delivery_address TEXT,
  p_delivery_state   TEXT,
  p_delivery_lga     TEXT,
  p_delivery_contact TEXT,
  p_metadata         JSONB,
  p_renewal_state    TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_transaction_id    BIGINT,
  out_order_id          BIGINT,
  out_already_processed BOOLEAN,
  out_balance_after     BIGINT
) AS $$
DECLARE
  v_wallet public.wallets;
  v_pps    RECORD;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'pay_with_wallet: invalid amount %', p_amount_kobo;
  END IF;

  -- Lock the wallet so balance check + debit are atomic against concurrent spends.
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  -- Idempotency: already debited for this reference → skip debit, just (re)fulfill.
  IF EXISTS (SELECT 1 FROM public.wallet_ledger WHERE reference = p_reference AND direction = 'debit') THEN
    SELECT * INTO v_pps FROM public.process_payment_success(
      p_reference, 'successful'::payment_status, 'wallet', NULL, NOW(),
      p_order_type, p_renewal_months, p_selected_items, p_renewal_amount, p_delivery_fee,
      p_delivery_address, p_delivery_state, p_delivery_lga, p_delivery_contact, p_metadata, p_renewal_state);
    RETURN QUERY SELECT v_pps.transaction_id, v_pps.order_id, TRUE, v_wallet.balance_kobo;
    RETURN;
  END IF;

  IF v_wallet.status = 'frozen' THEN
    RAISE EXCEPTION 'WALLET_FROZEN';
  END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  -- Debit
  UPDATE public.wallets
    SET balance_kobo = balance_kobo - p_amount_kobo
    WHERE id = v_wallet.id
    RETURNING balance_kobo INTO v_wallet.balance_kobo;

  INSERT INTO public.wallet_ledger (wallet_id, direction, amount_kobo, balance_after, reason, reference, transaction_id)
    VALUES (v_wallet.id, 'debit', p_amount_kobo, v_wallet.balance_kobo, 'payment', p_reference, p_transaction_id);

  -- Fulfill via the shared success path. Same transaction — if it raises, the
  -- debit above rolls back too.
  SELECT * INTO v_pps FROM public.process_payment_success(
    p_reference, 'successful'::payment_status, 'wallet', NULL, NOW(),
    p_order_type, p_renewal_months, p_selected_items, p_renewal_amount, p_delivery_fee,
    p_delivery_address, p_delivery_state, p_delivery_lga, p_delivery_contact, p_metadata, p_renewal_state);

  RETURN QUERY SELECT v_pps.transaction_id, v_pps.order_id, v_pps.already_processed, v_wallet.balance_kobo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
