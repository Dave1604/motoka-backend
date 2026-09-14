-- =============================================
-- Migration 099: Ladipo catalog integrity
-- (renumbered from 096 — main already carries
-- 096_payment_cancellation_reason; duplicate numbers
-- are how migrations got lost in the 064-067 incident)
--
-- Prepares the catalog tables for repeatable, auditable
-- AI-assisted seeding:
--   1. Re-declares the merchandising flags that only ever
--      landed via _duplicates/067 (present in prod, absent
--      from the numbered chain, so fresh envs break).
--   2. Makes importers idempotent — compatibility and
--      inventory could both be duplicated by a re-run.
--   3. Records where each fitment claim came from, so a
--      bad extraction batch can be found and revoked.
-- =============================================

-- ---------------------------------------------
-- 1. Merchandising flags (restores 067)
-- ---------------------------------------------
ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_essential BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_must_have BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_essential
  ON public.ladipo_parts(is_essential) WHERE is_essential = true;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_must_have
  ON public.ladipo_parts(is_must_have) WHERE is_must_have = true;

-- ---------------------------------------------
-- 2. Idempotency for re-runnable importers
-- ---------------------------------------------

-- Collapse any pre-existing duplicate fitment rows before the constraint
-- lands. NULL model / year bounds are common and must be treated as equal
-- here, which is why the grouping coalesces them.
DELETE FROM public.ladipo_part_compatibility a
USING public.ladipo_part_compatibility b
WHERE a.ctid > b.ctid
  AND a.part_id = b.part_id
  AND LOWER(COALESCE(a.make, '')) = LOWER(COALESCE(b.make, ''))
  AND LOWER(COALESCE(a.model, '')) = LOWER(COALESCE(b.model, ''))
  AND COALESCE(a.year_min, -1) = COALESCE(b.year_min, -1)
  AND COALESCE(a.year_max, -1) = COALESCE(b.year_max, -1);

-- NULLS NOT DISTINCT is what makes this useful: without it Postgres treats
-- every (part, make, NULL, NULL, NULL) row as unique and the constraint
-- would not stop the exact duplicates importers actually produce.
-- Requires PG15+; the project runs PG17.
CREATE UNIQUE INDEX IF NOT EXISTS ladipo_part_compatibility_unique
  ON public.ladipo_part_compatibility (part_id, make, model, year_min, year_max)
  NULLS NOT DISTINCT;

-- Keep the newest inventory row per part, then enforce one-per-part, which
-- every seeder already assumes when it reads price_kobo.
DELETE FROM public.ladipo_part_inventory a
USING public.ladipo_part_inventory b
WHERE a.part_id = b.part_id
  AND (a.created_at, a.ctid) < (b.created_at, b.ctid);

CREATE UNIQUE INDEX IF NOT EXISTS ladipo_part_inventory_part_unique
  ON public.ladipo_part_inventory (part_id);

-- ---------------------------------------------
-- 3. Fitment provenance
-- ---------------------------------------------
ALTER TABLE public.ladipo_part_compatibility
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

ALTER TABLE public.ladipo_part_compatibility
  DROP CONSTRAINT IF EXISTS ladipo_part_compatibility_source_check;

ALTER TABLE public.ladipo_part_compatibility
  DROP CONSTRAINT IF EXISTS ladipo_part_compatibility_source_check;

ALTER TABLE public.ladipo_part_compatibility
  ADD CONSTRAINT ladipo_part_compatibility_source_check
  CHECK (source IS NULL OR source IN ('ai', 'oem', 'rockauto', 'manual', 'seed'));

ALTER TABLE public.ladipo_part_compatibility
  DROP CONSTRAINT IF EXISTS ladipo_part_compatibility_confidence_check;

ALTER TABLE public.ladipo_part_compatibility
  ADD CONSTRAINT ladipo_part_compatibility_confidence_check
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

CREATE INDEX IF NOT EXISTS idx_ladipo_part_compatibility_source
  ON public.ladipo_part_compatibility(source);

COMMENT ON COLUMN public.ladipo_part_compatibility.source IS
  'Where this fitment claim came from: ai (LLM extraction, verified), oem (part-number decode), rockauto, manual, seed';
COMMENT ON COLUMN public.ladipo_part_compatibility.confidence IS
  'Extractor confidence 0-1. NULL for deterministic sources.';
COMMENT ON COLUMN public.ladipo_part_compatibility.verified_by IS
  'Which verification pass admitted the row, e.g. vehicle-catalog+oem-crosscheck';

-- ---------------------------------------------
-- 4. Staged products
-- ---------------------------------------------
-- Products whose fitment could not be verified are inserted with
-- is_active = false. Admin review lists them, shoppers never see them.
CREATE INDEX IF NOT EXISTS idx_ladipo_parts_staged
  ON public.ladipo_parts(created_at DESC) WHERE is_active = false;
