-- ============================================
-- RESTORE ORIGINAL PRODUCTION PRICES
-- ============================================
-- Run this AFTER testing to restore real prices

-- First, check what current test prices are
SELECT 'CURRENT TEST PRICES' as info;
SELECT 
    schedule_name,
    ROUND(price/100.0, 2) as current_price_naira
FROM payment_schedules
ORDER BY id
LIMIT 5;

-- To restore: You need to run the backup query from ORIGINAL_PRICES_BACKUP.sql
-- Then manually update each price back to its original value

-- Example restore commands (fill in original prices):
-- UPDATE payment_schedules SET price = [original_kobo_price] WHERE id = 1;
-- UPDATE payment_schedules SET price = [original_kobo_price] WHERE id = 2;
-- etc...

-- UPDATE states SET delivery_fee = [original_kobo_fee] WHERE id = 1;
-- UPDATE states SET delivery_fee = [original_kobo_fee] WHERE id = 2;
-- etc...
