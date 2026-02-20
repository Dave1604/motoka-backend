-- ============================================
-- CLEANUP TEST RENEWAL ITEMS AND TEST DATA
-- ============================================
-- Removes all test data created during Monicredit development
-- This includes:
-- - Test renewal items (with "_test" suffix)
-- - Test states (codes T1, T2, T3)
-- - Test LGAs (with "(TEST)" in name)
-- ============================================

BEGIN;

-- 1. Delete test renewal items
DELETE FROM renewal_items 
WHERE item_key LIKE '%_test';

-- 2. Delete test LGAs (must be deleted before states due to foreign key)
DELETE FROM local_governments 
WHERE name LIKE '%(TEST)';

-- 3. Delete test states
DELETE FROM states 
WHERE code IN ('T1', 'T2', 'T3');

-- 4. Verify cleanup (should return 0 rows)
SELECT 
    'Test Renewal Items' as category,
    COUNT(*) as remaining_count
FROM renewal_items
WHERE item_key LIKE '%_test'

UNION ALL

SELECT 
    'Test States' as category,
    COUNT(*) as remaining_count
FROM states
WHERE code IN ('T1', 'T2', 'T3')

UNION ALL

SELECT 
    'Test LGAs' as category,
    COUNT(*) as remaining_count
FROM local_governments
WHERE name LIKE '%(TEST)';

COMMIT;

-- ============================================
-- CLEANUP COMPLETE
-- ============================================
-- All test data has been removed from the database.
-- Production data remains untouched.
-- ============================================
