-- MIGRATION 046 – Update Customized plate number price
-- Date: 2026-03-11
-- Change:
--   plate_number_prices → set Customized plate to ₦550,000 (was ₦600,000)

UPDATE public.plate_number_prices
  SET price       = 550000,
      description = 'Personalised / custom plate number — ₦550,000',
      updated_at  = NOW()
  WHERE plate_type = 'Customized' AND sub_type IS NULL;
