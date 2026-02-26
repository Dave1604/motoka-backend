-- =============================================
-- RENEWAL ITEMS
-- Migration 020: Dynamic renewal item pricing
-- =============================================

CREATE TABLE IF NOT EXISTS public.renewal_items (
  id BIGSERIAL PRIMARY KEY,
  item_key VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  price BIGINT NOT NULL CHECK (price >= 0),
  required BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_renewal_items_active ON public.renewal_items(active);
CREATE INDEX idx_renewal_items_required ON public.renewal_items(required);

ALTER TABLE public.renewal_items ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active items
CREATE POLICY "Users can view renewal items"
  ON public.renewal_items
  FOR SELECT
  TO authenticated
  USING (active = true);

-- Service role has full access
CREATE POLICY "Service role full access on renewal items"
  ON public.renewal_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trigger_renewal_items_updated_at
  BEFORE UPDATE ON public.renewal_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Seed initial items
INSERT INTO public.renewal_items (item_key, name, price, required)
VALUES
  ('vehicle_licence', 'Vehicle Licence', 470000, true),
  ('road_worthiness', 'Road Worthiness', 1500000, false),
  ('insurance', 'Insurance', 1500000, false),
  ('referral', 'Referral', 329000, false),
  ('proof_of_ownership', 'Proof of Ownership', 100000, false)
ON CONFLICT (item_key) DO NOTHING;
