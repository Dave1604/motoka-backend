-- ============================================
-- TEMPORARY TEST DATA SETUP FOR DEVELOPMENT
-- ============================================
-- ⚠️ WARNING: THIS IS FOR DEVELOPMENT/TESTING ONLY ⚠️
-- DO NOT RUN IN PRODUCTION
-- 
-- Creates test renewal items and states with 500 Naira (50,000 kobo) prices
-- to avoid affecting production data during Monicredit integration testing
--
-- IMPORTANT: Monicredit uses NAIRA, not KOBO
-- Database stores in KOBO (multiply by 100)
-- 500 Naira = 50,000 kobo in database
-- 
-- Monicredit requires minimum amounts (appears to reject anything under 500 Naira)
-- ============================================
--
-- CLEANUP: After testing, run scripts/sql/cleanup-test-renewal-items.sql
-- ============================================

-- ============================================
-- 1. TEST RENEWAL ITEMS (500 Naira each)
-- ============================================

-- Insert test renewal items with "_test" suffix
-- ALL TEST ITEMS ARE NOT REQUIRED so you can select any combination for testing
INSERT INTO renewal_items (item_key, name, price, required, active, created_at, updated_at)
VALUES
  -- Test Vehicle License (500 Naira = 50,000 kobo) - NOT required
  ('vehicle_license_test', 'Vehicle License (TEST)', 50000, false, true, NOW(), NOW()),
  
  -- Test Road Worthiness (500 Naira = 50,000 kobo) - NOT required
  ('road_worthiness_test', 'Road Worthiness (TEST)', 50000, false, true, NOW(), NOW()),
  
  -- Test Insurance (500 Naira = 50,000 kobo) - NOT required
  ('insurance_test', 'Insurance (TEST)', 50000, false, true, NOW(), NOW()),
  
  -- Test Hackney Permit (500 Naira = 50,000 kobo) - NOT required
  ('hackney_permit_test', 'Hackney Permit (TEST)', 50000, false, true, NOW(), NOW())
ON CONFLICT (item_key) 
DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  required = EXCLUDED.required,
  active = EXCLUDED.active,
  updated_at = NOW();

-- ============================================
-- 2. TEST STATES (500 Naira delivery fee each)
-- ============================================

-- Actual schema: name, code, delivery_fee, is_active, display_order
-- Note: code column is VARCHAR(2), so we use short codes like T1, T2, T3

INSERT INTO states (code, name, delivery_fee, is_active, display_order, created_at, updated_at)
VALUES
  -- Test Lagos State (500 Naira = 50,000 kobo) - Code: T1
  ('T1', 'Lagos (TEST)', 50000, true, 999, NOW(), NOW()),
  
  -- Test Abuja FCT (500 Naira = 50,000 kobo) - Code: T2
  ('T2', 'Abuja FCT (TEST)', 50000, true, 999, NOW(), NOW()),
  
  -- Test Ogun State (500 Naira = 50,000 kobo) - Code: T3
  ('T3', 'Ogun (TEST)', 50000, true, 999, NOW(), NOW())
ON CONFLICT (code) 
DO UPDATE SET
  name = EXCLUDED.name,
  delivery_fee = EXCLUDED.delivery_fee,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- ============================================
-- 3. TEST LGAs (No separate price - inherits state delivery_fee)
-- ============================================

-- Actual schema: name, state_id, is_active, display_order
-- LGAs don't have their own price, they use the state's delivery_fee

-- First, we need to insert LGAs using the state_id from the test states above
-- We'll use a subquery to get the state_id

INSERT INTO local_governments (name, state_id, is_active, display_order, created_at, updated_at)
VALUES
  -- Test LGAs for Lagos (T1)
  ('Ikeja (TEST)', (SELECT id FROM states WHERE code = 'T1'), true, 999, NOW(), NOW()),
  ('Lagos Island (TEST)', (SELECT id FROM states WHERE code = 'T1'), true, 999, NOW(), NOW()),
  
  -- Test LGAs for Abuja (T2)
  ('Gwagwalada (TEST)', (SELECT id FROM states WHERE code = 'T2'), true, 999, NOW(), NOW()),
  ('Abuja Municipal (TEST)', (SELECT id FROM states WHERE code = 'T2'), true, 999, NOW(), NOW()),
  
  -- Test LGAs for Ogun (T3)
  ('Abeokuta North (TEST)', (SELECT id FROM states WHERE code = 'T3'), true, 999, NOW(), NOW()),
  ('Abeokuta South (TEST)', (SELECT id FROM states WHERE code = 'T3'), true, 999, NOW(), NOW())
ON CONFLICT (name, state_id) 
DO UPDATE SET
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- ============================================
-- 4. VERIFICATION QUERIES
-- ============================================

-- Check test renewal items were created
SELECT 
  item_key, 
  name, 
  price as price_in_kobo,
  (price / 100.0) as price_in_naira,
  required,
  active
FROM renewal_items
WHERE item_key LIKE '%_test'
ORDER BY required DESC, name;

-- Check test states were created (using codes T1, T2, T3)
SELECT 
  id,
  code,
  name,
  delivery_fee as delivery_fee_in_kobo,
  (delivery_fee / 100.0) as delivery_fee_in_naira,
  is_active,
  display_order
FROM states
WHERE code IN ('T1', 'T2', 'T3')
ORDER BY name;

-- Check test LGAs were created
SELECT 
  lg.id,
  lg.name,
  s.code as state_code,
  s.name as state_name,
  s.delivery_fee as delivery_fee_in_kobo,
  (s.delivery_fee / 100.0) as delivery_fee_in_naira,
  lg.is_active,
  lg.display_order
FROM local_governments lg
LEFT JOIN states s ON lg.state_id = s.id
WHERE lg.name LIKE '%(TEST)'
ORDER BY s.code, lg.name;

-- ============================================
-- USAGE NOTES
-- ============================================
-- 1. All test items are marked with "_test" suffix or "(TEST)" in name
-- 2. Test state codes are T1, T2, T3 (2-character limit)
-- 3. All prices are 500 Naira (50,000 kobo) for Monicredit minimum requirements
-- 4. Test items won't interfere with production data
-- 5. Use these test items when initializing payments during development:
--    {
--      "selected_items": ["vehicle_license_test", "road_worthiness_test"],
--      "payment_gateway": "monicredit"
--    }
--
-- TEST STATE CODES:
-- - T1 = Lagos (TEST)
-- - T2 = Abuja FCT (TEST)
-- - T3 = Ogun (TEST)
--
-- EXPECTED TEST PAYMENT AMOUNTS:
-- - 1 renewal item: 500 Naira
-- - 2 renewal items: 1,000 Naira
-- - 3 renewal items: 1,500 Naira
-- - 4 renewal items: 2,000 Naira
-- - With delivery (state T1, T2, or T3): item total + 500 Naira delivery fee
-- ============================================
