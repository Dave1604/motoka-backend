-- ============================================================
-- MIGRATION 081 – add 'wallet' to the payment_gateway enum
-- ============================================================
-- Paying from the wallet creates a payment_transactions row with
-- payment_gateway='wallet'. payment_gateway is a Postgres enum
-- ('paystack','monicredit'), so the value must exist (mirrors 026a which added
-- 'monicredit').
-- ============================================================

ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'wallet';
