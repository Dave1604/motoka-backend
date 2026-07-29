-- Server-authoritative Ladipo fitment matching.
-- Normalises harmless formatting differences while retaining strict make,
-- model and year matching.  It deliberately does not infer fitment from a
-- product title: non-universal parts must have an explicit compatibility row.

CREATE OR REPLACE FUNCTION public.ladipo_fitment_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(lower(trim(COALESCE(p_value, ''))), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.ladipo_make_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE public.ladipo_fitment_key(p_value)
    WHEN 'mercedes' THEN 'mercedesbenz'
    WHEN 'benz' THEN 'mercedesbenz'
    WHEN 'vw' THEN 'volkswagen'
    ELSE public.ladipo_fitment_key(p_value)
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_ladipo_compatible_part_ids(
  p_make text,
  p_model text DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS TABLE(part_id uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT c.part_id
  FROM public.ladipo_part_compatibility AS c
  WHERE public.ladipo_make_key(c.make) = public.ladipo_make_key(p_make)
    AND (
      NULLIF(trim(COALESCE(p_model, '')), '') IS NULL
      OR public.ladipo_fitment_key(COALESCE(c.model, '')) = public.ladipo_fitment_key(p_model)
    )
    AND (p_year IS NULL OR c.year_min IS NULL OR c.year_min <= p_year)
    AND (p_year IS NULL OR c.year_max IS NULL OR c.year_max >= p_year);
$$;

GRANT EXECUTE ON FUNCTION public.get_ladipo_compatible_part_ids(text, text, integer)
  TO anon, authenticated, service_role;
