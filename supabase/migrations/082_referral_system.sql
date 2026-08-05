-- ============================================================
-- MIGRATION 082 – Referral system
-- ============================================================
-- Double-sided wallet credits after the referred user's first
-- real purchase (not signup, not wallet funding).
--
-- Tables:
--   referral_settings  — admin-editable reward amounts
--   referral_codes     — one unique share code per user
--   referrals          — attribution + reward lifecycle
--
-- Also extends wallet_ledger.reason to include 'referral'.
-- ============================================================

-- ─── Settings (single active row; id = 1) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  referrer_reward_kobo    BIGINT NOT NULL DEFAULT 30000 CHECK (referrer_reward_kobo >= 0),
  referee_reward_kobo     BIGINT NOT NULL DEFAULT 30000 CHECK (referee_reward_kobo >= 0),
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  max_rewards_per_referrer INTEGER NULL CHECK (max_rewards_per_referrer IS NULL OR max_rewards_per_referrer > 0),
  updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.referral_settings (id, referrer_reward_kobo, referee_reward_kobo, is_active)
VALUES (1, 30000, 30000, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─── Codes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_codes_code_format CHECK (code ~ '^[A-Z0-9]{6,12}$')
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code
  ON public.referral_codes (code);

-- ─── Referrals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id                         BIGSERIAL PRIMARY KEY,
  referrer_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id                 UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code              TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected')),
  qualifying_transaction_id  BIGINT REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  qualifying_reference       TEXT,
  referrer_reward_kobo       BIGINT,
  referee_reward_kobo        BIGINT,
  fraud_notes                TEXT,
  attributed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qualified_at               TIMESTAMPTZ,
  rewarded_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_no_self CHECK (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status
  ON public.referrals (referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON public.referrals (status);
CREATE INDEX IF NOT EXISTS idx_referrals_referee
  ON public.referrals (referee_id);

CREATE OR REPLACE FUNCTION public.touch_referral_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON public.referrals;
CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.touch_referral_updated_at();

DROP TRIGGER IF EXISTS trg_referral_settings_updated_at ON public.referral_settings;
CREATE TRIGGER trg_referral_settings_updated_at
  BEFORE UPDATE ON public.referral_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_referral_updated_at();

-- ─── Extend wallet_ledger.reason with 'referral' ─────────────────────────────
ALTER TABLE public.wallet_ledger
  DROP CONSTRAINT IF EXISTS wallet_ledger_reason_check;

ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT wallet_ledger_reason_check
  CHECK (reason IN ('funding', 'payment', 'refund', 'admin_adjustment', 'reversal', 'referral'));

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.referral_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access referral_settings" ON public.referral_settings;
CREATE POLICY "Service role full access referral_settings"
  ON public.referral_settings FOR ALL
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Users view own referral code" ON public.referral_codes;
CREATE POLICY "Users view own referral code"
  ON public.referral_codes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access referral_codes" ON public.referral_codes;
CREATE POLICY "Service role full access referral_codes"
  ON public.referral_codes FOR ALL
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Users view own referrals as referrer" ON public.referrals;
CREATE POLICY "Users view own referrals as referrer"
  ON public.referrals FOR SELECT
  TO authenticated
  USING (referrer_id = auth.uid() OR referee_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access referrals" ON public.referrals;
CREATE POLICY "Service role full access referrals"
  ON public.referrals FOR ALL
  TO service_role USING (TRUE) WITH CHECK (TRUE);
