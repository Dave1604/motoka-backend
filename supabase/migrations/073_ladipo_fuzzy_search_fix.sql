-- =============================================
-- Migration 069: Fix Ladipo fuzzy search scoring
-- The original search_ladipo_parts_fuzzy used similarity(),
-- which scores whole-string similarity — a short 2-word query
-- against a long product name (brand + fitment details) gets
-- diluted below the match threshold even for an exact substring.
-- word_similarity() is built for exactly this case: it finds the
-- best-matching word-extent within the longer string instead of
-- comparing the whole string.
-- =============================================

CREATE OR REPLACE FUNCTION public.search_ladipo_parts_fuzzy(p_query text, p_limit int DEFAULT 30)
RETURNS TABLE(id uuid, similarity_score real)
LANGUAGE sql
STABLE
AS $$
  SELECT scored.id, scored.similarity_score
  FROM (
    SELECT
      p.id,
      GREATEST(
        word_similarity(p_query, p.name),
        word_similarity(p_query, COALESCE(p.brand, '')),
        word_similarity(p_query, COALESCE(p.description, ''))
      ) AS similarity_score
    FROM public.ladipo_parts p
    WHERE p.is_active = true
  ) scored
  WHERE scored.similarity_score > 0.25
  ORDER BY scored.similarity_score DESC
  LIMIT p_limit;
$$;
