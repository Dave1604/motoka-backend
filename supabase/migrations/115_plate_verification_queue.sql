-- =============================================
-- MIGRATION 115 – Plate verification queue for signup bonus
-- =============================================
-- Users who want the ₦2,000 signup bonus must have their plate number
-- verified on verify.autoreg.ng (external agency portal). Because that
-- portal sits behind reCAPTCHA and cannot be automated, verification is
-- manual: an admin opens the portal, pastes the plate, ticks the captcha,
-- then marks the user verified or rejected inside Motoka.
--
-- When verified, a ₦2,000 (200,000 kobo) wallet credit is granted via the
-- existing wallet_admin_adjust() function (restricted bonus logic applies).

-- ─── Schema ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plate_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS plate_verification_status TEXT
    DEFAULT 'pending'
    CHECK (plate_verification_status IN ('pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS plate_verification_note TEXT,
  ADD COLUMN IF NOT EXISTS plate_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plate_bonus_credited BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_plate_number ON public.profiles(plate_number);
CREATE INDEX IF NOT EXISTS idx_profiles_plate_status ON public.profiles(plate_verification_status);

-- ─── Index for fast queue lookups ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_plate_queue
  ON public.profiles (plate_verification_status, created_at)
  WHERE plate_verification_status = 'pending';
