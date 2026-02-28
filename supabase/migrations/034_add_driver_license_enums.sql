-- =============================================
-- Migration 034: Add driver_license to payment_type and order_type
-- =============================================

ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'driver_license';
ALTER TYPE order_type ADD VALUE IF NOT EXISTS 'driver_license';
