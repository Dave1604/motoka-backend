-- ============================================
-- RESTORE TO ORIGINAL DEFAULT PRICES
-- ============================================
-- These are the original prices from migration files

-- Restore renewal items to original prices
UPDATE renewal_items SET price = 470000 WHERE item_key = 'vehicle_licence';      -- ₦4,700
UPDATE renewal_items SET price = 1500000 WHERE item_key = 'road_worthiness';     -- ₦15,000
UPDATE renewal_items SET price = 1500000 WHERE item_key = 'insurance';           -- ₦15,000
UPDATE renewal_items SET price = 329000 WHERE item_key = 'referral';             -- ₦3,290
UPDATE renewal_items SET price = 100000 WHERE item_key = 'proof_of_ownership';   -- ₦1,000

-- Restore states to default ₦5,000 delivery fee (500000 kobo)
UPDATE states SET delivery_fee = 500000;

-- Verify restoration
SELECT 
    item_key,
    name,
    ROUND(price/100.0, 2) as price_naira
FROM renewal_items
ORDER BY id;

SELECT 
    code,
    name as state,
    ROUND(delivery_fee/100.0, 2) as delivery_fee_naira
FROM states
WHERE name IN ('Lagos', 'Abuja', 'Rivers', 'Oyo', 'Kano')
ORDER BY name;
