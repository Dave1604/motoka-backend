-- ============================================================
-- RESTORE REAL PRICES (production values)
-- ============================================================
UPDATE renewal_items SET price = 470000,  updated_at = NOW() WHERE item_key = 'vehicle_licence';
UPDATE renewal_items SET price = 1500000, updated_at = NOW() WHERE item_key = 'road_worthiness';
UPDATE renewal_items SET price = 1500000, updated_at = NOW() WHERE item_key = 'insurance';
UPDATE renewal_items SET price = 329000,  updated_at = NOW() WHERE item_key = 'referral';
UPDATE renewal_items SET price = 100000,  updated_at = NOW() WHERE item_key = 'proof_of_ownership';

-- Verify
SELECT id, item_key, name, price, (price/100.0) as price_naira FROM renewal_items ORDER BY id;
