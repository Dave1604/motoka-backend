-- ============================================
-- DRIVER LICENSE PRICES TABLE
-- Stores pricing for new vs renew driver's license.
-- Prices are in Naira (NGN) as whole integers.
-- ============================================

CREATE TABLE IF NOT EXISTS public.driver_license_prices (
  id          BIGSERIAL PRIMARY KEY,
  license_type VARCHAR(20) NOT NULL,   -- 'new' | 'renew'
  price       INTEGER     NOT NULL CHECK (price >= 0),
  description TEXT        DEFAULT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_driver_license_type UNIQUE (license_type)
);

CREATE OR REPLACE FUNCTION update_driver_license_prices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_driver_license_prices_updated_at
  BEFORE UPDATE ON public.driver_license_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_driver_license_prices_updated_at();

INSERT INTO public.driver_license_prices (license_type, price, description) VALUES
  ('new',   15000, 'New driver''s license application'),
  ('renew', 10000, 'Renewal of existing driver''s license')
ON CONFLICT (license_type) DO NOTHING;

ALTER TABLE public.driver_license_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view driver license prices"
  ON public.driver_license_prices FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

CREATE POLICY "Service role full access to driver license prices"
  ON public.driver_license_prices FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);
