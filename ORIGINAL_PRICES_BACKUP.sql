-- ============================================
-- ORIGINAL PRODUCTION PRICES - DO NOT DELETE!
-- ============================================
-- Run this SQL to get current prices before changing them

SELECT 
    id,
    schedule_name,
    price as price_kobo,
    ROUND(price/100.0, 2) as price_naira,
    payment_head_id
FROM payment_schedules
ORDER BY id;

-- Current prices (run above query to see them)
-- These will be restored after testing

SELECT 
    id,
    code,
    state_name,
    delivery_fee as fee_kobo,
    ROUND(delivery_fee/100.0, 2) as fee_naira
FROM states
ORDER BY id
LIMIT 10;
