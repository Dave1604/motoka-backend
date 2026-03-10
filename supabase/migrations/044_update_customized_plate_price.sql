-- ============================================================
-- MIGRATION 044 – Update Customized plate number price
-- ============================================================
-- Changes:
--   plate_number_prices → set Customized plate to ₦600,000
-- ============================================================

UPDATE public.plate_number_prices
  SET price       = 600000,
      description = 'Personalised / custom plate number',
      updated_at  = NOW()
  WHERE plate_type = 'Customized' AND sub_type IS NULL;
