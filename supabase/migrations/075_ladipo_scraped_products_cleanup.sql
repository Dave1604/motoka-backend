-- =============================================
-- Migration 071: Ladipo scraped-products cleanup
-- The import-ladipo-market.js (and earlier autofactor) scrapers were
-- creating brand-new top-level categories straight from scraped slugs
-- (e.g. "Engines", "Tyres Rims", "Batteries") instead of filing products
-- into the existing curated taxonomy from 065_ladipo_catalog_reseed.sql
-- (Spare Parts > Engine Parts, Tyres & Wheels > Car Tyres, etc.).
--
-- This wipes all products/inventory/compatibility/cart rows so the catalog
-- can be reseeded with the corrected scraper (which now maps into the
-- existing 26 canonical categories instead of creating new ones), and
-- removes every category NOT in that canonical set. User orders are left
-- untouched - ladipo_orders stores its own item snapshot in JSONB and has
-- no FK dependency on ladipo_parts or ladipo_categories.
-- =============================================

DELETE FROM public.ladipo_part_compatibility;
DELETE FROM public.ladipo_cart_items;
DELETE FROM public.ladipo_part_inventory;
DELETE FROM public.ladipo_parts;

DELETE FROM public.ladipo_categories
WHERE slug NOT IN (
  'spare-parts',
  'spare-parts-brake-wheel-hub-bearings',
  'spare-parts-suspension-parts',
  'spare-parts-engine-parts',
  'spare-parts-steering-parts',
  'spare-parts-exhaust-system',
  'servicing-parts',
  'servicing-parts-oil-filter',
  'servicing-parts-air-filter',
  'servicing-parts-spark-plugs',
  'servicing-parts-fuel-filter',
  'servicing-parts-timing-belts',
  'lubricants-fluids',
  'lubricants-fluids-engine-oil',
  'lubricants-fluids-gear-oil',
  'lubricants-fluids-brake-fluid-coolant',
  'tyres-wheels',
  'tyres-wheels-car-tyres',
  'tyres-wheels-alloy-wheels',
  'electrical-batteries',
  'electrical-batteries-car-batteries',
  'electrical-batteries-bulbs-lighting',
  'electrical-batteries-alternators',
  'car-accessories',
  'car-accessories-interior',
  'car-accessories-exterior'
);
