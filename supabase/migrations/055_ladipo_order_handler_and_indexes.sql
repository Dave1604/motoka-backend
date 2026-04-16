-- Add lightweight admin handling metadata for Ladipo orders.
ALTER TABLE public.ladipo_orders
ADD COLUMN IF NOT EXISTS handled_by_name VARCHAR(120);

-- Helps filter/sort by handler in admin views.
CREATE INDEX IF NOT EXISTS idx_ladipo_orders_handled_by_name
  ON public.ladipo_orders(handled_by_name);

-- Helps stable pagination in admin list queries.
CREATE INDEX IF NOT EXISTS idx_ladipo_orders_created_at
  ON public.ladipo_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_created_at
  ON public.ladipo_parts(created_at DESC);
