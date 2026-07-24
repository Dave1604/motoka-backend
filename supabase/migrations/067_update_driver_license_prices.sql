-- ============================================================
-- MIGRATION 067 – Driver license price update (July 2026)
-- ============================================================
-- Prices stored in whole Naira (NGN) in driver_license_prices.
--
-- New rates:
--   New   – 3 years : ₦50,000  (was ₦40,000)
--   New   – 5 years : ₦70,000  (was ₦50,000)
--   Renew – 3 years : ₦40,000  (was ₦25,000)
--   Renew – 5 years : ₦50,000  (was ₦35,000)
--
-- International (new) is unchanged (₦35,000).
-- ============================================================

UPDATE public.driver_license_prices
  SET price = 50000, updated_at = NOW()
  WHERE license_type = 'new' AND duration = '3yr';

UPDATE public.driver_license_prices
  SET price = 70000, updated_at = NOW()
  WHERE license_type = 'new' AND duration = '5yr';

UPDATE public.driver_license_prices
  SET price = 40000, updated_at = NOW()
  WHERE license_type = 'renew' AND duration = '3yr';

UPDATE public.driver_license_prices
  SET price = 50000, updated_at = NOW()
  WHERE license_type = 'renew' AND duration = '5yr';
