-- ============================================
-- BACKUP CURRENT PRICES - CORRECT VERSION
-- ============================================
-- SAVE THESE RESULTS TO A TEXT FILE!

-- 1. Backup all renewal item prices
SELECT 
    id,
    item_key,
    name,
    price as price_kobo,
    ROUND(price/100.0, 2) as price_naira,
    required
FROM renewal_items
ORDER BY id;

-- 2. Backup all state delivery fees
SELECT 
    id,
    code,
    name as state_name,
    delivery_fee as fee_kobo,
    ROUND(delivery_fee/100.0, 2) as fee_naira
FROM states
ORDER BY name;
