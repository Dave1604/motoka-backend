-- =============================================
-- Migration 057: Ladipo vehicle compatibility
-- Adds structured fitment matching for car-based
-- filtering and a universal-parts fallback flag.
-- =============================================

-- 1) Universal part switch (for oils/accessories/etc)
ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_universal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_universal
  ON public.ladipo_parts(is_universal);

-- 2) Compatibility table
CREATE TABLE IF NOT EXISTS public.ladipo_part_compatibility (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id      UUID NOT NULL REFERENCES public.ladipo_parts(id) ON DELETE CASCADE,
  make         VARCHAR(100) NOT NULL,
  model        VARCHAR(100),
  year_min     INTEGER,
  year_max     INTEGER,
  engine_code  VARCHAR(50),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ladipo_part_compatibility_year_range_check
    CHECK (
      (year_min IS NULL OR (year_min >= 1900 AND year_min <= 2100))
      AND (year_max IS NULL OR (year_max >= 1900 AND year_max <= 2100))
      AND (year_min IS NULL OR year_max IS NULL OR year_min <= year_max)
    )
);

CREATE INDEX IF NOT EXISTS idx_ladipo_part_compatibility_part_id
  ON public.ladipo_part_compatibility(part_id);

CREATE INDEX IF NOT EXISTS idx_ladipo_part_compatibility_make
  ON public.ladipo_part_compatibility(LOWER(make));

CREATE INDEX IF NOT EXISTS idx_ladipo_part_compatibility_make_model
  ON public.ladipo_part_compatibility(LOWER(make), LOWER(COALESCE(model, '')));

-- 3) RLS
ALTER TABLE public.ladipo_part_compatibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read ladipo_part_compatibility" ON public.ladipo_part_compatibility;
CREATE POLICY "Public read ladipo_part_compatibility"
  ON public.ladipo_part_compatibility FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role full access ladipo_part_compatibility" ON public.ladipo_part_compatibility;
CREATE POLICY "Service role full access ladipo_part_compatibility"
  ON public.ladipo_part_compatibility FOR ALL
  USING (auth.role() = 'service_role');

-- 4) Mark broad categories as universal by default
UPDATE public.ladipo_parts p
SET is_universal = true
FROM public.ladipo_categories c
WHERE p.category_id = c.id
  AND (
    c.slug ILIKE 'lubricants-fluids%'
    OR c.slug ILIKE 'accessories%'
    OR c.slug ILIKE 'servicing-parts%'
  );
