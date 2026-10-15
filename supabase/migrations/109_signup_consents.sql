-- Signup consents: terms acceptance timestamp and auto-renew opt-in.
-- Migration 105.
--
-- auto_renew lets a user authorise Motoka to start processing due renewals
-- without waiting for each manual order — including where payment for the
-- cycle has not yet cleared (see Terms §5). Off by default.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_renew_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_auto_renew
  ON public.profiles (auto_renew_enabled)
  WHERE auto_renew_enabled = true;
