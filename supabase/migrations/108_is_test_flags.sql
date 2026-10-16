-- Migration 108. Mark test / internal payments so they stop inflating revenue.
--
-- Revenue on the admin dashboard and payments page sums every `successful`
-- payment_transactions row and every `payment_success` guest order. Staff
-- test payments, demo accounts and a ₦550,000 plate-number test are in there.
-- A flag beats deleting rows: the money trail stays intact for reconciliation.
-- Which rows get flagged is a data decision made separately (not here).

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_is_test
  ON public.payment_transactions (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS idx_guest_renewal_orders_is_test
  ON public.guest_renewal_orders (is_test) WHERE is_test;
