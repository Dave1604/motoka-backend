-- Admin renewals: record whether papers were renewed through Motoka
-- (internal) or elsewhere (external), and who marked it.

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS last_renewal_channel TEXT,
  ADD COLUMN IF NOT EXISTS last_renewal_marked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_renewal_marked_by TEXT;

ALTER TABLE public.cars
  DROP CONSTRAINT IF EXISTS cars_last_renewal_channel_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_last_renewal_channel_check
  CHECK (last_renewal_channel IS NULL OR last_renewal_channel IN ('internal', 'external'));
