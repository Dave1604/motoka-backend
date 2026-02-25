-- ============================================================
-- SET TEST PRICES — ₦700 per item (70,000 kobo)
-- Run this to test the payment flow cheaply.
-- Run RESTORE_PRICES_CORRECT.sql to revert to real prices.
-- ============================================================

-- Backup current prices (view before running)
-- SELECT id, item_key, name, price, (price/100.0) as price_naira FROM renewal_items ORDER BY id;

UPDATE renewal_items SET price = 70000, updated_at = NOW();

-- Verify
SELECT id, item_key, name, price, (price/100.0) as price_naira FROM renewal_items ORDER BY id;
