-- ============================================================
-- MIGRATION 082 – Wallet system (Phase 3: admin adjustments)
-- ============================================================
-- wallet_admin_adjust() lets an admin credit or debit a wallet manually (e.g.
-- refunding a duplicate charge to wallet, or correcting an error). It's the same
-- locked, ledgered pattern as the rest of the wallet: balance never goes
-- negative, every adjustment is one append-only ledger row tagged with the admin
-- and a mandatory reason (note).
-- ============================================================

CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(
  p_user_id     UUID,
  p_direction   TEXT,     -- 'credit' | 'debit'
  p_amount_kobo BIGINT,
  p_admin_id    UUID,
  p_note        TEXT,     -- mandatory reason, enforced in the controller
  p_reference   TEXT
)
RETURNS TABLE (
  out_wallet_id     BIGINT,
  out_ledger_id     BIGINT,
  out_balance_after BIGINT
) AS $$
DECLARE
  v_wallet    public.wallets;
  v_ledger_id BIGINT;
  v_new       BIGINT;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'wallet_admin_adjust: amount must be positive (got %)', p_amount_kobo;
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'wallet_admin_adjust: direction must be credit or debit (got %)', p_direction;
  END IF;

  -- Get-or-create the wallet, locked so the balance change is atomic.
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance_kobo)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  IF p_direction = 'debit' AND v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  IF p_direction = 'credit' THEN
    UPDATE public.wallets SET balance_kobo = balance_kobo + p_amount_kobo
      WHERE id = v_wallet.id RETURNING balance_kobo INTO v_new;
  ELSE
    UPDATE public.wallets SET balance_kobo = balance_kobo - p_amount_kobo
      WHERE id = v_wallet.id RETURNING balance_kobo INTO v_new;
  END IF;

  INSERT INTO public.wallet_ledger (
    wallet_id, direction, amount_kobo, balance_after, reason, reference, admin_id, note
  ) VALUES (
    v_wallet.id, p_direction, p_amount_kobo, v_new, 'admin_adjustment', p_reference, p_admin_id, p_note
  ) RETURNING id INTO v_ledger_id;

  RETURN QUERY SELECT v_wallet.id, v_ledger_id, v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
