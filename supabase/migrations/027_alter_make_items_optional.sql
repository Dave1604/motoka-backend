-- =============================================
-- ALTER MIGRATION 027: Make All Renewal Items Optional
-- =============================================
-- This migration makes all renewal items optional (not required)
-- Users can now select any combination of items they want to renew
-- 
-- This is an ALTER migration because migrations 001-025 have already been run
-- in production. This migration is idempotent and safe to run multiple times.
-- =============================================

-- Update all renewal items to be optional (not required)
-- Only update items that are currently required to avoid unnecessary updates
UPDATE renewal_items 
SET 
  required = false,
  updated_at = NOW()
WHERE required = true;

-- Verify the update (commented out - uncomment for verification)
-- SELECT 
--   item_key,
--   name,
--   price as price_in_kobo,
--   (price / 100.0) as price_in_naira,
--   required,
--   active
-- FROM renewal_items
-- WHERE active = true
-- ORDER BY name;

-- ============================================
-- RESULT: All renewal items are now optional
-- Users can select any combination:
-- - Just Vehicle License
-- - Just Road Worthiness
-- - Just Insurance
-- - Any combination they need
-- ============================================
