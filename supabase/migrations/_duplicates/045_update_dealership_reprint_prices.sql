-- ============================================================
-- MIGRATION 045 – Update Dealership and Reprint plate prices
-- ============================================================
-- Changes:
--   plate_number_prices → Dealership Cooperate  ₦75,000  → ₦500,000
--   plate_number_prices → Dealership Business   ₦60,000  → ₦500,000
--   plate_number_prices → Reprint               ₦15,000  → ₦500,000
-- ============================================================

UPDATE public.plate_number_prices
  SET price      = 500000,
      updated_at = NOW()
  WHERE plate_type = 'Dealership' AND sub_type = 'Cooperate';

UPDATE public.plate_number_prices
  SET price      = 500000,
      updated_at = NOW()
  WHERE plate_type = 'Dealership' AND sub_type = 'Business';

UPDATE public.plate_number_prices
  SET price      = 500000,
      updated_at = NOW()
  WHERE plate_type = 'Reprint' AND sub_type IS NULL;
