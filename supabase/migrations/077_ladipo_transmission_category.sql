-- Transmission & Drivetrain subcategory under Spare Parts.
-- Gearboxes / CV axles / drivetrain hardware must NOT live under
-- Lubricants → Gear Oil & ATF (fluids only).

INSERT INTO public.ladipo_categories (id, name, slug, parent_id, sort_order) VALUES
  (
    'c1000000-0000-0000-0000-000000000027',
    'Transmission & Drivetrain',
    'spare-parts-transmission-drivetrain',
    'c1000000-0000-0000-0000-000000000001',
    6
  )
ON CONFLICT (slug) DO NOTHING;
