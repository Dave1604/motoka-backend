-- =============================================
-- Migration 048: Driver License Application History
--
-- Problem: The unique constraint on (user_id, application_type) means a user
-- can only ever have one 'new' and one 'renew' application — applying again
-- after approval blocks them forever.
--
-- Fix: Drop the unique constraint and introduce is_current to distinguish
-- the active application from historical ones. Application history is preserved.
-- =============================================

-- 1. Drop the blocking unique constraint
ALTER TABLE public.driver_license_applications
  DROP CONSTRAINT IF EXISTS unique_user_application_type;

-- 2. Add is_current flag — marks the active application per (user, type).
--    All existing rows are assumed to be current (single row per user/type).
ALTER TABLE public.driver_license_applications
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;

-- 3. Efficient lookup index replaces the dropped unique index
CREATE INDEX IF NOT EXISTS idx_driver_license_applications_current
  ON public.driver_license_applications (user_id, application_type, is_current);

-- 4. Partial index for the most common query pattern: fetch current draft/submitted
CREATE INDEX IF NOT EXISTS idx_driver_license_applications_current_active
  ON public.driver_license_applications (user_id, application_type)
  WHERE is_current = TRUE;
