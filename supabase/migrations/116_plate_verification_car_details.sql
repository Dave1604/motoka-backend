-- =============================================
-- MIGRATION 116 – Car detail capture for plate verification
-- =============================================
-- When an admin manually verifies a plate on verify.autoreg.ng, they can see
-- the car's details (chassis, color, brand, model, year). We store those on
-- the profile so the add-car flow can be pre-filled later, speeding up
-- vehicle registration.
--
-- Also updates the bonus flow: ₦2,000 is credited immediately at signup
-- (status = 'pending'), and clawed back via debit if verification is rejected.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chassis_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS car_color VARCHAR(50),
  ADD COLUMN IF NOT EXISTS car_brand VARCHAR(100),
  ADD COLUMN IF NOT EXISTS car_model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS car_year INTEGER;

CREATE INDEX IF NOT EXISTS idx_profiles_chassis ON public.profiles(chassis_number);
