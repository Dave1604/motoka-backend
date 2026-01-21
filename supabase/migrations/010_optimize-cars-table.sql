-- ============================================
-- Car Table Performance Optimization
-- ============================================
-- Run this in Supabase SQL Editor to optimize car queries
-- These indexes will significantly improve query performance

-- Index 1: Optimize queries filtering by deleted_at
-- Used by: getCars, getCarBySlug, updateCar, deleteCar
-- Benefit: Much faster queries that filter out deleted cars
CREATE INDEX IF NOT EXISTS idx_cars_deleted_at 
ON cars(deleted_at) 
WHERE deleted_at IS NULL;

-- Index 2: Optimize user-specific queries with deleted filter
-- Used by: All car endpoints (they filter by user_id and deleted_at)
-- Benefit: Faster lookup of user's active cars
CREATE INDEX IF NOT EXISTS idx_cars_user_deleted 
ON cars(user_id, deleted_at);

-- Index 3: Optimize ordering by created_at (used in pagination)
-- Used by: getCars (orders by created_at DESC)
-- Benefit: Faster pagination and sorting
CREATE INDEX IF NOT EXISTS idx_cars_created_at 
ON cars(created_at DESC);

-- Index 4: Optimize slug lookups (primary lookup key)
-- Used by: getCarBySlug, updateCar, deleteCar
-- Benefit: Faster car retrieval by slug
-- Note: If slug is already your primary key or has unique constraint, this may already exist
CREATE INDEX IF NOT EXISTS idx_cars_slug 
ON cars(slug) 
WHERE deleted_at IS NULL;

-- Index 5: Optimize duplicate checks on unique identifiers
-- Used by: addCar, updateCar (checking for duplicate registration_no)
-- Benefit: Faster duplicate detection
CREATE INDEX IF NOT EXISTS idx_cars_registration_no 
ON cars(registration_no) 
WHERE deleted_at IS NULL AND registration_no IS NOT NULL;

-- Index 6: Optimize duplicate checks on chassis number
-- Used by: addCar, updateCar (checking for duplicate chasis_no)
-- Benefit: Faster duplicate detection
CREATE INDEX IF NOT EXISTS idx_cars_chasis_no 
ON cars(chasis_no) 
WHERE deleted_at IS NULL AND chasis_no IS NOT NULL;

-- Index 7: Optimize duplicate checks on engine number
-- Used by: addCar, updateCar (checking for duplicate engine_no)
-- Benefit: Faster duplicate detection
CREATE INDEX IF NOT EXISTS idx_cars_engine_no 
ON cars(engine_no) 
WHERE deleted_at IS NULL AND engine_no IS NOT NULL;

-- ============================================
-- Verify Indexes Created Successfully
-- ============================================
-- Run this query to see all indexes on the cars table:
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'cars';

-- ============================================
-- Performance Analysis (Optional)
-- ============================================
-- After creating indexes, you can analyze query performance:
-- EXPLAIN ANALYZE SELECT * FROM cars WHERE user_id = 'your-user-id' AND deleted_at IS NULL;

-- ============================================
-- Expected Performance Improvements
-- ============================================
-- Before indexes:
--   - Sequential scan on large tables (slow)
--   - Full table scan for every query
-- 
-- After indexes:
--   - Index scan (much faster)
--   - Queries should be 10-100x faster depending on table size
--   - Pagination will be smoother
--   - Duplicate checks will be instant

-- ============================================
-- Notes
-- ============================================
-- 1. These indexes use "IF NOT EXISTS" so safe to run multiple times
-- 2. Indexes take up storage space but dramatically improve read performance
-- 3. For tables with < 1000 rows, impact may be minimal
-- 4. For tables with 10,000+ rows, these indexes are essential
-- 5. The WHERE clauses on indexes (partial indexes) save space and improve performance
