-- Add global uniqueness constraints for registration_no, chasis_no, and engine_no
-- These constraints ensure no two users can have the same values (excluding NULL and soft-deleted records)

-- Drop existing indexes if they exist (they may have been created in 007_cars.sql)
DROP INDEX IF EXISTS idx_cars_registration_no_unique;
DROP INDEX IF EXISTS idx_cars_chasis_no_unique;
DROP INDEX IF EXISTS idx_cars_engine_no_unique;

-- Create unique constraints for global uniqueness (excluding NULL and soft-deleted records)
CREATE UNIQUE INDEX idx_cars_registration_no_unique ON cars(registration_no) WHERE registration_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_cars_chasis_no_unique ON cars(chasis_no) WHERE chasis_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_cars_engine_no_unique ON cars(engine_no) WHERE engine_no IS NOT NULL AND deleted_at IS NULL;
