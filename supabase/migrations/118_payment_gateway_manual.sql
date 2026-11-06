-- =============================================
-- MIGRATION 118 – 'manual' payment gateway
-- =============================================
-- Customers sometimes pay off the site (bank transfer, cash, POS). An admin
-- needs to record that and raise the order, and renewal_orders.transaction_id
-- is NOT NULL, so the off-site payment becomes a real payment_transactions row.
-- It carries gateway 'manual' so revenue reporting can tell it apart from the
-- gateways that confirmed themselves.

ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'manual';
