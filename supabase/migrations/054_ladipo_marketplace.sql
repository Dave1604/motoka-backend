-- =============================================
-- Migration 050: Ladipo Marketplace
-- Vehicle parts marketplace: categories, parts,
-- inventory, and orders tables.
-- =============================================

-- ─── 1. Categories ───────────────────────────
CREATE TABLE IF NOT EXISTS public.ladipo_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  slug         VARCHAR(100) NOT NULL UNIQUE,
  parent_id    UUID REFERENCES public.ladipo_categories(id) ON DELETE SET NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ladipo_categories_slug ON public.ladipo_categories(slug);
CREATE INDEX idx_ladipo_categories_parent ON public.ladipo_categories(parent_id);

-- ─── 2. Parts ────────────────────────────────
CREATE TYPE public.ladipo_condition AS ENUM ('new', 'tokunbo', 'nigerian_used');
CREATE TYPE public.ladipo_part_type AS ENUM ('oem', 'oes', 'aftermarket');

CREATE TABLE IF NOT EXISTS public.ladipo_parts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku            VARCHAR(100) UNIQUE,
  slug           VARCHAR(200) NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  category_id    UUID REFERENCES public.ladipo_categories(id) ON DELETE SET NULL,
  brand          VARCHAR(100),
  condition      public.ladipo_condition NOT NULL DEFAULT 'new',
  part_type      public.ladipo_part_type NOT NULL DEFAULT 'aftermarket',
  images         JSONB NOT NULL DEFAULT '[]'::jsonb,
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  key_features   JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ladipo_parts_slug        ON public.ladipo_parts(slug);
CREATE INDEX idx_ladipo_parts_category    ON public.ladipo_parts(category_id);
CREATE INDEX idx_ladipo_parts_is_active   ON public.ladipo_parts(is_active);
CREATE INDEX idx_ladipo_parts_name_search ON public.ladipo_parts USING gin(to_tsvector('english', name || ' ' || COALESCE(brand, '')));

-- ─── 3. Inventory ────────────────────────────
CREATE TABLE IF NOT EXISTS public.ladipo_part_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id       UUID NOT NULL REFERENCES public.ladipo_parts(id) ON DELETE CASCADE,
  price_kobo    INT NOT NULL CHECK (price_kobo >= 0),
  stock_qty     INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  seller_label  VARCHAR(100) NOT NULL DEFAULT 'Motoka',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ladipo_inventory_part ON public.ladipo_part_inventory(part_id);

-- ─── 4. Orders ───────────────────────────────
CREATE TYPE public.ladipo_payment_status AS ENUM ('pending_payment', 'paid', 'failed');
CREATE TYPE public.ladipo_order_status   AS ENUM ('pending_payment', 'processing', 'shipped', 'delivered', 'cancelled');

CREATE TABLE IF NOT EXISTS public.ladipo_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        TEXT NOT NULL UNIQUE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_kobo       INT NOT NULL DEFAULT 0,
  delivery_fee_kobo   INT NOT NULL DEFAULT 0,
  total_kobo          INT NOT NULL DEFAULT 0,
  delivery            JSONB,
  paystack_reference  TEXT UNIQUE,
  payment_status      public.ladipo_payment_status NOT NULL DEFAULT 'pending_payment',
  order_status        public.ladipo_order_status   NOT NULL DEFAULT 'pending_payment',
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ladipo_orders_user       ON public.ladipo_orders(user_id);
CREATE INDEX idx_ladipo_orders_reference  ON public.ladipo_orders(paystack_reference);
CREATE INDEX idx_ladipo_orders_number     ON public.ladipo_orders(order_number);

-- ─── 5. Row Level Security ───────────────────
ALTER TABLE public.ladipo_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ladipo_parts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ladipo_part_inventory  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ladipo_orders          ENABLE ROW LEVEL SECURITY;

-- Public read: categories, parts, inventory (browse without login)
CREATE POLICY "Public read ladipo_categories"
  ON public.ladipo_categories FOR SELECT
  USING (true);

CREATE POLICY "Public read ladipo_parts"
  ON public.ladipo_parts FOR SELECT
  USING (is_active = true);

CREATE POLICY "Public read ladipo_part_inventory"
  ON public.ladipo_part_inventory FOR SELECT
  USING (true);

-- Orders: users can only see their own; service_role bypasses RLS automatically
CREATE POLICY "Users read own ladipo_orders"
  ON public.ladipo_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access ladipo_orders"
  ON public.ladipo_orders FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access ladipo_categories"
  ON public.ladipo_categories FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access ladipo_parts"
  ON public.ladipo_parts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access ladipo_inventory"
  ON public.ladipo_part_inventory FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 6. Seed Data ────────────────────────────

-- Categories
INSERT INTO public.ladipo_categories (id, name, slug, sort_order) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Tyres',         'tyres',         1),
  ('a1000000-0000-0000-0000-000000000002', 'Engine Parts',  'engine-parts',  2),
  ('a1000000-0000-0000-0000-000000000003', 'Accessories',   'accessories',   3)
ON CONFLICT (slug) DO NOTHING;

-- Parts
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features) VALUES
(
  'b1000000-0000-0000-0000-000000000001',
  'TYR-MCH-P4-225',
  'michelin-primacy-4-225-55r17',
  'Michelin Primacy 4 — 225/55R17',
  'Premium touring tyre offering excellent wet grip and long tread life.',
  'a1000000-0000-0000-0000-000000000001',
  'Michelin',
  'new',
  'oem',
  '["https://placehold.co/400x300?text=Michelin+Primacy+4"]',
  '{"size": "225/55R17", "load_index": "101W", "speed_rating": "W"}',
  '[{"title": "Wet grip: ", "text": "A-rated wet braking for safety in rain."}, {"title": "Long life: ", "text": "Up to 20% longer tread life vs predecessors."}]'
),
(
  'b1000000-0000-0000-0000-000000000002',
  'TYR-BRG-T005-235',
  'bridgestone-turanza-t005-235-45r18',
  'Bridgestone Turanza T005 — 235/45R18',
  'Ultra-high-performance touring tyre for sedans and SUVs.',
  'a1000000-0000-0000-0000-000000000001',
  'Bridgestone',
  'new',
  'oem',
  '["https://placehold.co/400x300?text=Bridgestone+T005"]',
  '{"size": "235/45R18", "load_index": "98Y", "speed_rating": "Y"}',
  '[{"title": "Aquaplaning resistance: ", "text": "Full-length centre groove evacuates water fast."}, {"title": "Comfort: ", "text": "Noise-absorbing compound for a quiet ride."}]'
),
(
  'b1000000-0000-0000-0000-000000000003',
  'TYR-HNK-K120-265',
  'hankook-ventus-k120-265-35r20',
  'Hankook Ventus K120 — 265/35R20',
  'Sport performance tyre engineered for precise handling and high speed.',
  'a1000000-0000-0000-0000-000000000001',
  'Hankook',
  'new',
  'aftermarket',
  '["https://placehold.co/400x300?text=Hankook+K120"]',
  '{"size": "265/35R20", "load_index": "99Y", "speed_rating": "Y"}',
  '[{"title": "Cornering: ", "text": "Asymmetric tread for enhanced lateral grip."}, {"title": "Heat dispersal: ", "text": "Advanced compound resists heat build-up at speed."}]'
),
(
  'b1000000-0000-0000-0000-000000000004',
  'ENG-NGK-BKR6E',
  'ngk-bkr6e-spark-plug',
  'NGK BKR6E Spark Plug',
  'OEM-spec copper core spark plug for most Japanese and European petrol engines.',
  'a1000000-0000-0000-0000-000000000002',
  'NGK',
  'new',
  'oem',
  '["https://placehold.co/400x300?text=NGK+BKR6E"]',
  '{"thread_size": "14mm", "reach": "19mm", "gap": "0.8mm"}',
  '[{"title": "Copper core: ", "text": "Superior conductivity and reliable cold starts."}, {"title": "Anti-corrosion: ", "text": "Nickel-plated shell resists corrosion."}]'
),
(
  'b1000000-0000-0000-0000-000000000005',
  'ENG-MAN-OIL-FL',
  'mann-oil-filter-w71380',
  'Mann-Filter W 713/80 Oil Filter',
  'High-quality spin-on oil filter for VAG, BMW, and GM group engines.',
  'a1000000-0000-0000-0000-000000000002',
  'Mann-Filter',
  'new',
  'oes',
  '["https://placehold.co/400x300?text=Mann+Oil+Filter"]',
  '{"thread": "M20x1.5", "height": "76mm", "bypass_valve": "1.5 bar"}',
  '[{"title": "Cellulose media: ", "text": "Filters particles down to 20 microns."}, {"title": "Anti-drainback: ", "text": "Prevents dry starts after engine off."}]'
),
(
  'b1000000-0000-0000-0000-000000000006',
  'ACC-CAR-COVER-L',
  'universal-car-cover-large',
  'Universal Waterproof Car Cover — Large',
  'All-weather outdoor car cover for sedans and medium SUVs.',
  'a1000000-0000-0000-0000-000000000003',
  'Motoka',
  'new',
  'aftermarket',
  '["https://placehold.co/400x300?text=Car+Cover"]',
  '{"material": "190T polyester", "size": "Large (up to 4.8m)", "layers": "3"}',
  '[{"title": "Waterproof: ", "text": "Keeps out rain, dust, and UV rays."}, {"title": "Universal fit: ", "text": "Elastic hem fits most sedan and SUV bodies."}]'
)
ON CONFLICT (slug) DO NOTHING;

-- Inventory (one row per part, Motoka as sole seller for Phase 1)
INSERT INTO public.ladipo_part_inventory (part_id, price_kobo, stock_qty, seller_label) VALUES
  ('b1000000-0000-0000-0000-000000000001', 8500000,  12, 'Motoka'),  -- ₦85,000
  ('b1000000-0000-0000-0000-000000000002', 9200000,   8, 'Motoka'),  -- ₦92,000
  ('b1000000-0000-0000-0000-000000000003', 11000000,  5, 'Motoka'),  -- ₦110,000
  ('b1000000-0000-0000-0000-000000000004',   350000, 50, 'Motoka'),  -- ₦3,500
  ('b1000000-0000-0000-0000-000000000005',   450000, 40, 'Motoka'),  -- ₦4,500
  ('b1000000-0000-0000-0000-000000000006',  1800000, 20, 'Motoka')   -- ₦18,000
ON CONFLICT DO NOTHING;

-- ─── 7. Stock decrement RPC ──────────────────
-- Used by the webhook/verify flow to safely decrement stock
CREATE OR REPLACE FUNCTION public.decrement_ladipo_stock(
  p_inventory_id UUID,
  p_qty          INT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.ladipo_part_inventory
  SET
    stock_qty  = GREATEST(0, stock_qty - p_qty),
    updated_at = NOW()
  WHERE id = p_inventory_id;
END;
$$;
