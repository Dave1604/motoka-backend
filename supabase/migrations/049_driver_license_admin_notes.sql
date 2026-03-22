-- =============================================
-- Migration 049: Admin notes on driver license applications
-- Adds admin_notes field for rejection reasons / processing notes
-- =============================================

ALTER TABLE public.driver_license_applications
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;
