-- Scheduled renewals: pay anytime, process from 30 days before expiry.
-- Migration 100.
--
-- 1. New order_status value. ADD VALUE is its own statement: on PG12+ it may
--    run inside the migration transaction, but the value must not be *used*
--    in the same transaction — nothing below references 'scheduled'.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'scheduled';

-- 2. Hold date on signed-in renewal orders. NULL = actionable now.
ALTER TABLE public.renewal_orders
  ADD COLUMN IF NOT EXISTS scheduled_for DATE;
CREATE INDEX IF NOT EXISTS idx_renewal_orders_scheduled_due
  ON public.renewal_orders (scheduled_for)
  WHERE status = 'scheduled';

-- 3. Same hold date on guest orders. Their fulfilment gate is
--    linked_user_id IS NOT NULL (registration required before processing).
ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS scheduled_for DATE;
ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_guest_orders_scheduled_due
  ON public.guest_renewal_orders (scheduled_for)
  WHERE payment_status = 'payment_success' AND scheduled_for IS NOT NULL;

-- NOTE: idx_renewal_orders_car_pending_unique deliberately still covers only
-- ('pending','processing'). Chained next-cycle orders are legitimately
-- scheduled while an earlier cycle is in flight; same-cycle duplicates are
-- refused in application logic (payment-init confirm_duplicate gate).
