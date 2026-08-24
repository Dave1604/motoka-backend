-- Shipments for KXpress / Mercury waybills (document, plate, and DL orders)

CREATE TABLE IF NOT EXISTS public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(32) NOT NULL DEFAULT 'kxpress',
  order_type VARCHAR(32) NOT NULL,
  order_id BIGINT,
  order_number TEXT,
  guest_order_id UUID,
  waybill_number TEXT UNIQUE,
  tracking_url TEXT,
  label_url TEXT,
  shipping_fee_kobo BIGINT,
  weight_kg NUMERIC(10, 3),
  estimated_weight_kg NUMERIC(10, 3),
  status VARCHAR(64) NOT NULL DEFAULT 'created',
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_admin_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipments_order_ref CHECK (
    order_id IS NOT NULL OR guest_order_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON public.shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order_number ON public.shipments(order_number);
CREATE INDEX IF NOT EXISTS idx_shipments_guest_order_id ON public.shipments(guest_order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_waybill ON public.shipments(waybill_number);

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access shipments"
  ON public.shipments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users read own shipments"
  ON public.shipments
  FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.renewal_orders WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.shipments IS 'Courier waybills generated via Mercury/KXpress for Motoka document orders.';
