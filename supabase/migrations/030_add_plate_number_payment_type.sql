-- =============================================
-- Migration 030: Add plate_number to payment_type enum
-- =============================================

-- Add 'plate_number' to the payment_type enum
-- IF NOT EXISTS prevents error if migration is re-run
ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'plate_number';
