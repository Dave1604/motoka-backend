-- Migration 112. Record what an admin saw on the Lagos MVAA verification
-- portal (verify.autoreg.ng) for a car. The portal has no API and sits behind
-- a CAPTCHA, so the check is done by hand and the result stored here; the
-- admin UI links out, the admin types back what it said.

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS mvaa_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mvaa_checked_by TEXT,
  ADD COLUMN IF NOT EXISTS mvaa_vehicle_licence_expiry DATE,
  ADD COLUMN IF NOT EXISTS mvaa_road_worthiness_expiry DATE;
