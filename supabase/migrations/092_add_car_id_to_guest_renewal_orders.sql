-- Add car_id to guest_renewal_orders so guest orders can be linked to a
-- specific car in a user's garage after they register / log in.
ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS car_id BIGINT REFERENCES public.cars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_renewal_orders_car_id
  ON public.guest_renewal_orders(car_id);
