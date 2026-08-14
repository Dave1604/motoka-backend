-- =============================================
-- Migration 068: Ladipo fuzzy/typo-tolerant search
-- Enables pg_trgm trigram similarity so a search like
-- "brke pad" still surfaces "brake pad" results, instead
-- of the plain ilike substring match finding nothing.
-- =============================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes speed up similarity lookups on the columns we search.
CREATE INDEX IF NOT EXISTS idx_ladipo_parts_name_trgm
  ON public.ladipo_parts USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_brand_trgm
  ON public.ladipo_parts USING gin (brand gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_description_trgm
  ON public.ladipo_parts USING gin (description gin_trgm_ops);

-- Returns part ids ranked by trigram similarity to p_query across
-- name/brand/description. Used as a fallback when the literal
-- ilike + synonym search in ladipo.service.js finds nothing —
-- the most likely cause of zero literal matches is a typo.
CREATE OR REPLACE FUNCTION public.search_ladipo_parts_fuzzy(p_query text, p_limit int DEFAULT 30)
RETURNS TABLE(id uuid, similarity_score real)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    GREATEST(
      similarity(p.name, p_query),
      similarity(COALESCE(p.brand, ''), p_query),
      similarity(COALESCE(p.description, ''), p_query)
    ) AS similarity_score
  FROM public.ladipo_parts p
  WHERE p.is_active = true
    AND (
      p.name % p_query
      OR COALESCE(p.brand, '') % p_query
      OR COALESCE(p.description, '') % p_query
    )
  ORDER BY similarity_score DESC
  LIMIT p_limit;
$$;
