-- Guest order fulfilment: mirror the signed-in orders flow so admins can
-- check and process guest renewals (pending → processing → completed/cancelled).
-- Migration 104 (was 103; 103 is profiles.email_verified_at, already on prod).
--
-- guest_renewal_orders previously only tracked payment_status; there was no
-- fulfilment state, so paid guest orders had no Check/Process path in admin.

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(20) NOT NULL DEFAULT 'pending';

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS processing_notes TEXT;

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS assigned_to UUID;

-- Backfill: paid orders without fulfilment state start as pending (New).
UPDATE public.guest_renewal_orders
  SET fulfillment_status = 'pending'
  WHERE fulfillment_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_guest_renewal_orders_fulfillment
  ON public.guest_renewal_orders (fulfillment_status);
