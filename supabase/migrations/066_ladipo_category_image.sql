-- =============================================
-- Migration 064: Ladipo category image
-- Adds image_url to ladipo_categories so admins can
-- set category images from the admin panel instead of
-- hardcoding them in the frontend.
-- =============================================

ALTER TABLE public.ladipo_categories
ADD COLUMN IF NOT EXISTS image_url TEXT;
