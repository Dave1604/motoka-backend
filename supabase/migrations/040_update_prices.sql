-- ============================================================
-- MIGRATION 040 – Motoka price list update (March 2026)
-- ============================================================
-- Sources: Motoka price comparison spreadsheet
--
-- Changes:
--   1. driver_license_prices → add duration column, re-seed
--   2. renewal_items          → correct prices, add hackney_permit + digital_copy
--   3. plate_number_prices    → update Normal plate base price
-- ============================================================

-- ─── 1. DRIVER LICENSE PRICES ───────────────────────────────────────────────
-- Add duration column ('3yr' | '5yr' | 'international')
ALTER TABLE public.driver_license_prices
  ADD COLUMN IF NOT EXISTS duration VARCHAR(20) DEFAULT NULL;

-- Drop the old single-column unique constraint so we can have multiple rows per license_type
ALTER TABLE public.driver_license_prices
  DROP CONSTRAINT IF EXISTS unique_driver_license_type;

-- New unique constraint: each (license_type, duration) pair must be unique
ALTER TABLE public.driver_license_prices
  ADD CONSTRAINT unique_driver_license_duration
  UNIQUE (license_type, duration);

-- Clear stale seed data and insert real prices (prices stored in Naira)
DELETE FROM public.driver_license_prices;

INSERT INTO public.driver_license_prices (license_type, duration, price, description) VALUES
  ('new',   '3yr',           40000, 'New driver''s license – 3 years'),
  ('new',   '5yr',           50000, 'New driver''s license – 5 years'),
  ('new',   'international', 35000, 'New driver''s license – International'),
  ('renew', '3yr',           25000, 'Driver''s license renewal – 3 years'),
  ('renew', '5yr',           35000, 'Driver''s license renewal – 5 years')
ON CONFLICT (license_type, duration) DO UPDATE
  SET price = EXCLUDED.price,
      description = EXCLUDED.description,
      updated_at = NOW();

-- ─── 2. RENEWAL ITEMS ────────────────────────────────────────────────────────
-- Prices stored in KOBO (multiply naira × 100).
-- New rates from spreadsheet (base: <1.6 litre engine):
--   Vehicle Licence             : ₦5,000  → 500,000 kobo
--   Road Worthiness + Referral  : ₦11,500 → 1,150,000 kobo  (combined line item)
--   Insurance                   : ₦15,000 → 1,500,000 kobo  (unchanged)
--   Proof of Ownership          : ₦3,000  → 300,000 kobo
--   Hackney Permit              : ₦4,000  → 400,000 kobo     (NEW – commercial vehicles)
--   Keeping Digital Copy        : ₦0      → 0                (NEW – free)

UPDATE public.renewal_items
  SET name = 'Vehicle Licence', price = 500000, updated_at = NOW()
  WHERE item_key = 'vehicle_licence';

-- Road Worthiness now covers referral – rename and update price
UPDATE public.renewal_items
  SET name = 'Road Worthiness + Referral', price = 1150000, updated_at = NOW()
  WHERE item_key = 'road_worthiness';

-- Deactivate the separate referral row (now bundled into road_worthiness)
UPDATE public.renewal_items
  SET active = false, updated_at = NOW()
  WHERE item_key = 'referral';

UPDATE public.renewal_items
  SET name = 'Insurance', price = 1500000, updated_at = NOW()
  WHERE item_key = 'insurance';

UPDATE public.renewal_items
  SET name = 'Proof of Ownership', price = 300000, updated_at = NOW()
  WHERE item_key = 'proof_of_ownership';

-- Add Hackney Permit (for commercial vehicles)
INSERT INTO public.renewal_items (item_key, name, price, required, active)
VALUES ('hackney_permit', 'Hackney Permit', 400000, false, true)
ON CONFLICT (item_key) DO UPDATE
  SET price = 400000, name = 'Hackney Permit', active = true, updated_at = NOW();

-- Add free digital copy item
INSERT INTO public.renewal_items (item_key, name, price, required, active)
VALUES ('digital_copy', 'Keeping Digital Copy', 0, false, true)
ON CONFLICT (item_key) DO UPDATE
  SET price = 0, name = 'Keeping Digital Copy', active = true, updated_at = NOW();

-- ─── 3. PLATE NUMBER PRICES ──────────────────────────────────────────────────
-- Base price for standard Normal plate (Lagos / Ogun / rest, <1.6L engine).
-- Per-engine-type variation (110,200 / 112,400 / 114,380) requires engine_size
-- to be tracked on car registrations – handled in a future migration.
UPDATE public.plate_number_prices
  SET price = 110200,
      description = 'Standard plate – base price (<1.6L engine)',
      updated_at = NOW()
  WHERE plate_type = 'Normal' AND sub_type IS NULL;
