-- ============================================
-- RESTORE ORIGINAL PRICES - CORRECT VERSION
-- ============================================
-- Use the backup file you saved earlier

-- Example restore for renewal items:
-- UPDATE renewal_items SET price = 470000 WHERE item_key = 'vehicle_licence';
-- UPDATE renewal_items SET price = 1500000 WHERE item_key = 'road_worthiness';
-- UPDATE renewal_items SET price = 1500000 WHERE item_key = 'insurance';
-- UPDATE renewal_items SET price = 329000 WHERE item_key = 'referral';
-- UPDATE renewal_items SET price = 100000 WHERE item_key = 'proof_of_ownership';

-- Example restore for states (use your actual backup values):
-- UPDATE states SET delivery_fee = 600000 WHERE code = 'LA';  -- Lagos
-- UPDATE states SET delivery_fee = 500000 WHERE code = 'FC';  -- Abuja
-- UPDATE states SET delivery_fee = 550000 WHERE code = 'OY';  -- Oyo
-- etc...

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
WHERE name IN ('Lagos', 'Abuja', 'Rivers', 'Oyo')
ORDER BY name;
