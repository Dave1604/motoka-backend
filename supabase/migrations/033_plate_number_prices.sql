-- ============================================
-- PLATE NUMBER PRICES TABLE
-- Stores pricing for each plate number type/sub-type.
-- Prices are in Naira (NGN) as whole integers.
-- Admins can update prices directly in this table.
-- ============================================

CREATE TABLE IF NOT EXISTS public.plate_number_prices (
  id          BIGSERIAL PRIMARY KEY,
  plate_type  VARCHAR(20)  NOT NULL,           -- Normal | Customized | Dealership | Reprint
  sub_type    VARCHAR(20)  DEFAULT NULL,       -- NULL for Normal/Customized/Reprint; 'Cooperate' or 'Business' for Dealership
  price       INTEGER      NOT NULL CHECK (price >= 0),  -- Price in Naira
  description TEXT         DEFAULT NULL,       -- Optional human-readable label
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_plate_sub_type UNIQUE (plate_type, sub_type)
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_plate_number_prices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_plate_number_prices_updated_at
  BEFORE UPDATE ON public.plate_number_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_plate_number_prices_updated_at();

-- ============================================
-- SEED DEFAULT PRICES
-- Update these values in the Supabase dashboard
-- or run an UPDATE statement whenever prices change.
-- ============================================
INSERT INTO public.plate_number_prices (plate_type, sub_type, price, description) VALUES
  ('Normal',      NULL,          25000,  'Ordinary / Standard plate number'),
  ('Customized',  NULL,          50000,  'Personalised / custom plate number'),
  ('Dealership',  'Cooperate',   75000,  'Dealership plate – corporate entity'),
  ('Dealership',  'Business',    60000,  'Dealership plate – business entity'),
  ('Reprint',     NULL,          15000,  'Reprint of existing plate number')
ON CONFLICT (plate_type, sub_type) DO NOTHING;

-- RLS: anyone authenticated can read prices (public pricing info)
ALTER TABLE public.plate_number_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view plate prices"
  ON public.plate_number_prices FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

CREATE POLICY "Service role full access to plate prices"
  ON public.plate_number_prices FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);
