-- =============================================
-- Migration 031: Add plate_number to order_type enum
-- =============================================
-- The order_type enum must include 'plate_number' for the
-- process_payment_success RPC to accept plate number payments.
-- =============================================

ALTER TYPE order_type ADD VALUE IF NOT EXISTS 'plate_number';
