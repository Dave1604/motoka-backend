-- =============================================
-- Migration 067: Ladipo merchandising flags
-- Adds admin-controlled is_essential / is_must_have
-- flags so the "Essential Products" and "Must Have"
-- sections on the Ladipo landing view show exactly
-- what an admin has chosen to feature — not a guess.
-- =============================================

ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_essential BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ladipo_parts
ADD COLUMN IF NOT EXISTS is_must_have BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_essential
  ON public.ladipo_parts(is_essential) WHERE is_essential = true;

CREATE INDEX IF NOT EXISTS idx_ladipo_parts_is_must_have
  ON public.ladipo_parts(is_must_have) WHERE is_must_have = true;
