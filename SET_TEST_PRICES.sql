-- ============================================
-- TEMPORARY TEST PRICES FOR LIVE TESTING
-- ============================================
-- All items: ₦1,000 (100,000 kobo)
-- All delivery: ₦500 (50,000 kobo)

-- Update all payment schedule prices to ₦1,000
UPDATE payment_schedules 
SET price = 100000
WHERE price IS NOT NULL;

-- Update all state delivery fees to ₦500
UPDATE states 
SET delivery_fee = 50000
WHERE delivery_fee IS NOT NULL;

-- Verify changes
SELECT 
    'Payment Schedules' as table_name,
    COUNT(*) as total_items,
    COUNT(DISTINCT price) as unique_prices,
    ROUND(MIN(price)/100.0, 2) as min_price_naira,
    ROUND(MAX(price)/100.0, 2) as max_price_naira
FROM payment_schedules
UNION ALL
SELECT 
    'State Delivery Fees' as table_name,
    COUNT(*) as total_items,
    COUNT(DISTINCT delivery_fee) as unique_prices,
    ROUND(MIN(delivery_fee)/100.0, 2) as min_fee_naira,
    ROUND(MAX(delivery_fee)/100.0, 2) as max_fee_naira
FROM states;
