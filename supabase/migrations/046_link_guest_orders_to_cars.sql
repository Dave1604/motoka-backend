-- =============================================
-- Migration 046: Link guest renewal orders to cars
-- =============================================

-- IMPORTANT: cars.id is BIGINT, so car_id must also be BIGINT.
-- This migration is written for fresh environments (where car_id does not
-- yet exist). In your current dev DB you already fixed the type manually.

ALTER TABLE public.guest_renewal_orders
ADD COLUMN IF NOT EXISTS car_id BIGINT REFERENCES public.cars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_renewal_orders_car_id
  ON public.guest_renewal_orders(car_id);

