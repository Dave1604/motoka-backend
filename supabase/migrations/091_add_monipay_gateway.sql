-- ============================================================
-- MIGRATION 091 – add 'monipay' to the payment_gateway enum
-- ============================================================
-- New payments use Monipay (https://api.monipay.ng). payment_gateway is a
-- Postgres enum ('paystack','monicredit','wallet'), so 'monipay' must exist
-- before inserts. Historical 'monicredit' rows stay valid.
-- ============================================================

ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'monipay';
