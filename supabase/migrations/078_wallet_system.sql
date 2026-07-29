-- ============================================================
-- MIGRATION 078 – Wallet system (Phase 1: ledger + funding)
-- ============================================================
-- A store-credit wallet. Users fund it via Paystack and (Phase 2) spend it on
-- Motoka services. Money math is in KOBO integers, consistent with the rest of
-- the payment system.
--
-- Design:
--   * wallets        — one row per user; balance_kobo is a CACHED mirror of the
--                      ledger, always written in the same txn as the ledger row,
--                      guarded by CHECK (balance_kobo >= 0).
--   * wallet_ledger  — append-only. Every credit/debit is one row. Balance is
--                      the running sum; balance_after snapshots it for audit.
--   * wallet_credit() — the ONLY way balance increases. Row-locked + idempotent
--                       on `reference`, so a replayed Paystack webhook cannot
--                       double-credit.
--
-- Phase 1 ships credit only (funding). The debit/spend RPC lands in Phase 2 so
-- we never entangle the fragile process_payment_success order path.
-- ============================================================

-- ─── Tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallets (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_kobo BIGINT NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  currency     TEXT NOT NULL DEFAULT 'NGN',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id             BIGSERIAL PRIMARY KEY,
  wallet_id      BIGINT NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_kobo    BIGINT NOT NULL CHECK (amount_kobo > 0),
  balance_after  BIGINT NOT NULL CHECK (balance_after >= 0),
  reason         TEXT NOT NULL CHECK (reason IN ('funding', 'payment', 'refund', 'admin_adjustment', 'reversal')),
  -- Idempotency key. For funding this is the payment reference, so a replayed
  -- webhook maps to the same ledger row instead of crediting twice.
  reference      TEXT NOT NULL UNIQUE,
  transaction_id BIGINT REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  order_id       BIGINT REFERENCES public.renewal_orders(id) ON DELETE SET NULL,
  admin_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet_created
  ON public.wallet_ledger (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_transaction
  ON public.wallet_ledger (transaction_id);

-- keep updated_at fresh on wallets
CREATE OR REPLACE FUNCTION public.touch_wallet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallets_updated_at ON public.wallets;
CREATE TRIGGER trg_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_wallet_updated_at();

-- ─── wallet_credit(): idempotent, row-locked credit ─────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_credit(
  p_user_id        UUID,
  p_amount_kobo    BIGINT,
  p_reason         TEXT,
  p_reference      TEXT,
  p_transaction_id BIGINT DEFAULT NULL,
  p_admin_id       UUID DEFAULT NULL,
  p_note           TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_wallet_id     BIGINT,
  out_ledger_id     BIGINT,
  out_balance_after BIGINT,
  out_already_done  BOOLEAN
) AS $$
DECLARE
  v_wallet    public.wallets;
  v_ledger_id BIGINT;
  v_existing  public.wallet_ledger;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'wallet_credit: amount must be positive (got %)', p_amount_kobo;
  END IF;

  -- Get-or-create the wallet, then hold a row lock so concurrent credits to the
  -- same wallet serialize (webhook + verify can both fire for one funding).
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance_kobo)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  -- Idempotency: with the wallet lock held, a duplicate reference is already
  -- committed by the earlier caller, so we see it and no-op.
  SELECT * INTO v_existing FROM public.wallet_ledger WHERE reference = p_reference LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.wallet_id, v_existing.id, v_existing.balance_after, TRUE;
    RETURN;
  END IF;

  IF v_wallet.status = 'frozen' THEN
    RAISE EXCEPTION 'wallet_credit: wallet is frozen for user %', p_user_id;
  END IF;

  UPDATE public.wallets
    SET balance_kobo = balance_kobo + p_amount_kobo
    WHERE id = v_wallet.id
    RETURNING balance_kobo INTO v_wallet.balance_kobo;

  INSERT INTO public.wallet_ledger (
    wallet_id, direction, amount_kobo, balance_after, reason, reference,
    transaction_id, admin_id, note
  ) VALUES (
    v_wallet.id, 'credit', p_amount_kobo, v_wallet.balance_kobo, p_reason, p_reference,
    p_transaction_id, p_admin_id, p_note
  ) RETURNING id INTO v_ledger_id;

  RETURN QUERY SELECT v_wallet.id, v_ledger_id, v_wallet.balance_kobo, FALSE;
EXCEPTION
  -- Backstop for the (already-serialized) race: unique reference collision means
  -- another caller committed it; return that row as already-done.
  WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.wallet_ledger WHERE reference = p_reference LIMIT 1;
    RETURN QUERY SELECT v_existing.wallet_id, v_existing.id, v_existing.balance_after, TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RLS: users read their own wallet + ledger; writes only via RPC/service ──
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own wallet" ON public.wallets;
CREATE POLICY "Users view own wallet"
  ON public.wallets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access wallets" ON public.wallets;
CREATE POLICY "Service role full access wallets"
  ON public.wallets FOR ALL
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Users view own wallet ledger" ON public.wallet_ledger;
CREATE POLICY "Users view own wallet ledger"
  ON public.wallet_ledger FOR SELECT
  TO authenticated
  USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role full access wallet ledger" ON public.wallet_ledger;
CREATE POLICY "Service role full access wallet ledger"
  ON public.wallet_ledger FOR ALL
  TO service_role USING (TRUE) WITH CHECK (TRUE);
