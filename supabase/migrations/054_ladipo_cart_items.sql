-- =============================================
-- Migration 054: Ladipo persistent cart items
-- Stores cart items per authenticated user.
-- =============================================

CREATE TABLE IF NOT EXISTS public.ladipo_cart_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.ladipo_parts(id) ON DELETE CASCADE,
  quantity   INT NOT NULL CHECK (quantity >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ladipo_cart_unique_user_product
  ON public.ladipo_cart_items(user_id, product_id);

CREATE INDEX IF NOT EXISTS idx_ladipo_cart_user_id
  ON public.ladipo_cart_items(user_id);

ALTER TABLE public.ladipo_cart_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ladipo_cart_items'
      AND policyname = 'Users manage own ladipo_cart_items'
  ) THEN
    CREATE POLICY "Users manage own ladipo_cart_items"
      ON public.ladipo_cart_items FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ladipo_cart_items'
      AND policyname = 'Service role full access ladipo_cart_items'
  ) THEN
    CREATE POLICY "Service role full access ladipo_cart_items"
      ON public.ladipo_cart_items FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
