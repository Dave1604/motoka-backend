-- Marketing attribution for guest checkouts: where the payer came from
-- (UTMs captured by the frontend), so guest revenue becomes attributable
-- without joining Paystack dashboards by hand.

ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS attribution_source TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT;

CREATE INDEX IF NOT EXISTS guest_renewal_orders_attribution_source_idx
  ON public.guest_renewal_orders (attribution_source)
  WHERE attribution_source IS NOT NULL;
