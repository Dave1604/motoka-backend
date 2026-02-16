-- ============================================
-- SET TEST PRICES - CORRECT VERSION
-- ============================================
-- All items: ₦1,000 (100,000 kobo)
-- All delivery: ₦500 (50,000 kobo)

-- Update all renewal item prices to ₦1,000
UPDATE renewal_items 
SET price = 100000
WHERE price IS NOT NULL;

-- Update all state delivery fees to ₦500
UPDATE states 
SET delivery_fee = 50000
WHERE delivery_fee IS NOT NULL;

-- Verify changes
SELECT 
    'Renewal Items' as table_name,
    COUNT(*) as total_items,
    COUNT(DISTINCT price) as unique_prices,
    ROUND(MIN(price)/100.0, 2) as min_price_naira,
    ROUND(MAX(price)/100.0, 2) as max_price_naira
FROM renewal_items
UNION ALL
SELECT 
    'State Delivery Fees' as table_name,
    COUNT(*) as total_items,
    COUNT(DISTINCT delivery_fee) as unique_prices,
    ROUND(MIN(delivery_fee)/100.0, 2) as min_fee_naira,
    ROUND(MAX(delivery_fee)/100.0, 2) as max_fee_naira
FROM states;

-- Show sample items
SELECT 
    name,
    ROUND(price/100.0, 2) as price_naira
FROM renewal_items
ORDER BY id;

-- Show sample states
SELECT 
    name as state,
    ROUND(delivery_fee/100.0, 2) as delivery_fee_naira
FROM states
WHERE name IN ('Lagos', 'Abuja', 'Rivers', 'Oyo')
ORDER BY name;
