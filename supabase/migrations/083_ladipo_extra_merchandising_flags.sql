-- =============================================
-- Migration 083: Extra Ladipo merchandising flags
-- Adds admin-controlled Featured / Bestsellers / Deals
-- rails alongside Essential Products and Must Have.
-- Membership is explicit — never inferred from sales.
-- =============================================

ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_deal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_featured
  ON public.ladipo_parts(is_featured) WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_bestseller
  ON public.ladipo_parts(is_bestseller) WHERE is_bestseller = true;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_deal
  ON public.ladipo_parts(is_deal) WHERE is_deal = true;
