-- ============================================================
-- MIGRATION 114 – Welcome bonus for adding your first car (restricted)
-- ============================================================
-- A user who adds their FIRST car to Motoka gets a one-time ₦2,000
-- (200,000 kobo) wallet credit. It is RESTRICTED money:
--   * spendable only through wallet payments (renewals, plate, driver's
--     licence — the only wallet spend paths that exist),
--   * never withdrawable, and
--   * it expires 356 days after it is granted.
--
-- Design:
--   * wallets.bonus_balance_kobo — the restricted slice of balance_kobo.
--     Invariant: balance_kobo = cash + bonus, and bonus_balance <= balance.
--     balance_kobo stays the single source of truth for spendable funds, so
--     liability/reconciliation math is unchanged.
--   * wallets.bonus_expires_at — expiry of the granted bonus (one grant per
--     user, enforced by the idempotent ledger reference
--     first_car_bonus_<user_id>).
--   * Debit paths consume bonus FIRST (pay_with_wallet, wallet_admin_adjust)
--     so the invariant survives every write.
--   * Expiry is lazy: enforced on wallet reads and inside pay_with_wallet via
--     wallet_expire_bonus(). No cron needed.
--   * The grant runs from an AFTER INSERT trigger on cars, so it covers every
--     path that adds a car. A failed bonus logs a warning but NEVER blocks
--     car creation.
-- ============================================================

-- ─── Schema ─────────────────────────────────────────────────────────────────
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS bonus_balance_kobo BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_expires_at TIMESTAMPTZ;

-- The restricted slice can never exceed the total balance.
ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_bonus_within_balance
  CHECK (bonus_balance_kobo <= balance_kobo);

ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_reason_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check
  CHECK (reason IN ('funding', 'payment', 'refund', 'admin_adjustment', 'reversal',
                    'referral', 'first_car_bonus', 'bonus_expiry'));

-- ─── wallet_grant_bonus(): idempotent restricted credit ─────────────────────
CREATE OR REPLACE FUNCTION public.wallet_grant_bonus(
  p_user_id     UUID,
  p_amount_kobo BIGINT,
  p_expires_at  TIMESTAMPTZ,
  p_reference   TEXT
) RETURNS VOID AS $$
DECLARE
  v_wallet public.wallets;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN;
  END IF;

  -- Get-or-create the wallet, then lock: concurrent grants for the same user
  -- serialize here and the second one sees the reference and no-ops.
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance_kobo)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  IF EXISTS (SELECT 1 FROM public.wallet_ledger WHERE reference = p_reference) THEN
    RETURN; -- already granted
  END IF;

  UPDATE public.wallets
     SET balance_kobo       = balance_kobo + p_amount_kobo,
         bonus_balance_kobo = bonus_balance_kobo + p_amount_kobo,
         bonus_expires_at   = p_expires_at
   WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, direction, amount_kobo, balance_after, reason, reference, note
  )
  SELECT v_wallet.id, 'credit', p_amount_kobo, balance_kobo, 'first_car_bonus',
         p_reference,
         'Welcome bonus for adding your first car — expires '
           || to_char(p_expires_at, 'YYYY-MM-DD')
    FROM public.wallets WHERE id = v_wallet.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── wallet_expire_bonus(): zero out a stale bonus slice, ledgered ──────────
CREATE OR REPLACE FUNCTION public.wallet_expire_bonus(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_wallet public.wallets;
  v_amount BIGINT;
  v_new    BIGINT;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND
     OR v_wallet.bonus_balance_kobo <= 0
     OR v_wallet.bonus_expires_at IS NULL
     OR v_wallet.bonus_expires_at > NOW() THEN
    RETURN COALESCE(v_wallet.balance_kobo, 0);
  END IF;

  v_amount := LEAST(v_wallet.bonus_balance_kobo, v_wallet.balance_kobo);

  UPDATE public.wallets
     SET bonus_balance_kobo = 0,
         bonus_expires_at   = NULL,
         balance_kobo       = balance_kobo - v_amount
   WHERE id = v_wallet.id
   RETURNING balance_kobo INTO v_new;

  BEGIN
    INSERT INTO public.wallet_ledger (
      wallet_id, direction, amount_kobo, balance_after, reason, reference, note
    ) VALUES (
      v_wallet.id, 'debit', v_amount, v_new, 'bonus_expiry',
      'bonus_expiry_' || v_wallet.id,
      'Welcome bonus expired on ' || to_char(v_wallet.bonus_expires_at, 'YYYY-MM-DD')
    );
  EXCEPTION WHEN unique_violation THEN
    NULL; -- already processed; balance math above is guarded by the bonus > 0 check
  END;

  RETURN v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── grant_first_car_bonus(): AFTER INSERT trigger on cars ──────────────────
-- Fires only for a user's FIRST car ever (previously deleted cars still count
-- as "already added", so deleting and re-adding cannot re-trigger it). The
-- idempotent ledger reference is the hard backstop.
CREATE OR REPLACE FUNCTION public.grant_first_car_bonus()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cars WHERE user_id = NEW.user_id AND id <> NEW.id
  ) THEN
    RETURN NEW; -- not their first car
  END IF;

  PERFORM public.wallet_grant_bonus(
    NEW.user_id,
    200000,                            -- ₦2,000
    NOW() + INTERVAL '356 days',
    'first_car_bonus_' || NEW.user_id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A failed bonus must never block car creation.
  RAISE WARNING 'grant_first_car_bonus failed for user %: %', NEW.user_id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS cars_first_car_bonus ON public.cars;
CREATE TRIGGER cars_first_car_bonus
  AFTER INSERT ON public.cars
  FOR EACH ROW EXECUTE FUNCTION public.grant_first_car_bonus();

-- ─── pay_with_wallet(): expire stale bonus, then spend bonus first ──────────
-- Same signature/behaviour as migration 080, plus restricted-bonus handling.
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
  v_wallet     public.wallets;
  v_pps        RECORD;
  v_bonus_used BIGINT;
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

  -- Lazy expiry: burn any stale welcome bonus before spending (same txn, same lock).
  PERFORM public.wallet_expire_bonus(p_user_id);
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  -- Restricted bonus is consumed FIRST; the rest comes from topped-up cash.
  v_bonus_used := LEAST(v_wallet.bonus_balance_kobo, p_amount_kobo);

  UPDATE public.wallets
     SET balance_kobo       = balance_kobo - p_amount_kobo,
         bonus_balance_kobo = bonus_balance_kobo - v_bonus_used
   WHERE id = v_wallet.id
   RETURNING balance_kobo INTO v_wallet.balance_kobo;

  INSERT INTO public.wallet_ledger (
    wallet_id, direction, amount_kobo, balance_after, reason, reference, transaction_id, note
  ) VALUES (
    v_wallet.id, 'debit', p_amount_kobo, v_wallet.balance_kobo, 'payment', p_reference, p_transaction_id,
    CASE WHEN v_bonus_used > 0 THEN
      'Includes ' || to_char(v_bonus_used / 100.0, 'FM999,999,990.00') || ' welcome bonus'
    ELSE NULL END
  );

  -- Fulfill via the shared success path. Same transaction — if it raises, the
  -- debit above rolls back too.
  SELECT * INTO v_pps FROM public.process_payment_success(
    p_reference, 'successful'::payment_status, 'wallet', NULL, NOW(),
    p_order_type, p_renewal_months, p_selected_items, p_renewal_amount, p_delivery_fee,
    p_delivery_address, p_delivery_state, p_delivery_lga, p_delivery_contact, p_metadata, p_renewal_state);

  RETURN QUERY SELECT v_pps.transaction_id, v_pps.order_id, v_pps.already_processed, v_wallet.balance_kobo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── wallet_admin_adjust(): same bonus-first rule for manual debits ─────────
-- Same signature/behaviour as migration 087, plus restricted-bonus handling.
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
  v_wallet     public.wallets;
  v_ledger_id  BIGINT;
  v_new        BIGINT;
  v_bonus_used BIGINT;
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

  -- Burn stale bonus first so bonus_balance <= balance survives every path.
  PERFORM public.wallet_expire_bonus(p_user_id);
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF p_direction = 'debit' AND v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  IF p_direction = 'credit' THEN
    UPDATE public.wallets SET balance_kobo = balance_kobo + p_amount_kobo
      WHERE id = v_wallet.id RETURNING balance_kobo INTO v_new;
  ELSE
    v_bonus_used := LEAST(v_wallet.bonus_balance_kobo, p_amount_kobo);
    UPDATE public.wallets
       SET balance_kobo       = balance_kobo - p_amount_kobo,
           bonus_balance_kobo = bonus_balance_kobo - v_bonus_used
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
