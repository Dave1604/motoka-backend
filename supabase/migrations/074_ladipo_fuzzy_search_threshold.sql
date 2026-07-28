-- =============================================
-- Migration 070: Tune Ladipo fuzzy search threshold
-- Empirical testing showed real typo matches consistently
-- score 0.5+ (e.g. "brke pad" -> 0.58, "sprk plug" -> 0.62),
-- while unrelated noise sits around 0.33. Raising the cutoff
-- from 0.25 to 0.4 keeps all genuine typo-tolerant matches
-- while cutting that noise.
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
  WHERE scored.similarity_score > 0.4
  ORDER BY scored.similarity_score DESC
  LIMIT p_limit;
$$;
