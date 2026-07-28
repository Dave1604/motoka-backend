-- =============================================
-- Migration 064: Ladipo catalog cleanup
-- Wipes all seeded categories, parts, inventory, cart
-- items, and vehicle-compatibility rows so the catalog
-- can be reseeded from scratch with real car-fitment data
-- (migration 065). User orders are left untouched —
-- ladipo_orders stores its own item snapshot in JSONB and
-- has no FK dependency on ladipo_parts, so historical
-- orders remain readable after this cleanup.
-- =============================================

-- Child tables first (no FK from ladipo_orders to these, so order is just for clarity)
DELETE FROM public.ladipo_part_compatibility;
DELETE FROM public.ladipo_cart_items;
DELETE FROM public.ladipo_part_inventory;
DELETE FROM public.ladipo_parts;
DELETE FROM public.ladipo_categories;
