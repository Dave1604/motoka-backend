-- ============================================================
-- MIGRATION 079 – add 'wallet_funding' to the payment_type enum
-- ============================================================
-- payment_transactions.payment_type is a Postgres enum. Wallet funding creates
-- a payment_transactions row with payment_type='wallet_funding', so the value
-- must exist in the enum (mirrors migration 034 which added 'driver_license').
-- ============================================================

ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'wallet_funding';
