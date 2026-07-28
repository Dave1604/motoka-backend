-- =============================================
-- Migration 065: Ladipo catalog reseed
-- Fresh categories (slugs match frontend CATEGORY_VISUALS
-- in apiLadipoCategories.js) + products with REAL rows in
-- ladipo_part_compatibility so car-based filtering works.
-- Run after 064_ladipo_catalog_cleanup.sql.
-- =============================================

-- --------------------------------------------------------
-- CATEGORIES
-- --------------------------------------------------------
INSERT INTO public.ladipo_categories (id, name, slug, parent_id, sort_order) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Spare Parts',            'spare-parts',            NULL, 1),
  ('c1000000-0000-0000-0000-000000000002', 'Brake & Wheel Hub/Bearings', 'spare-parts-brake-wheel-hub-bearings', 'c1000000-0000-0000-0000-000000000001', 1),
  ('c1000000-0000-0000-0000-000000000003', 'Suspension Parts',       'spare-parts-suspension-parts',          'c1000000-0000-0000-0000-000000000001', 2),
  ('c1000000-0000-0000-0000-000000000004', 'Engine Parts',           'spare-parts-engine-parts',               'c1000000-0000-0000-0000-000000000001', 3),
  ('c1000000-0000-0000-0000-000000000005', 'Steering Parts',         'spare-parts-steering-parts',             'c1000000-0000-0000-0000-000000000001', 4),
  ('c1000000-0000-0000-0000-000000000006', 'Exhaust System',         'spare-parts-exhaust-system',             'c1000000-0000-0000-0000-000000000001', 5),

  ('c1000000-0000-0000-0000-000000000007', 'Servicing Parts',        'servicing-parts',         NULL, 2),
  ('c1000000-0000-0000-0000-000000000008', 'Oil Filter',             'servicing-parts-oil-filter',   'c1000000-0000-0000-0000-000000000007', 1),
  ('c1000000-0000-0000-0000-000000000009', 'Air Filter',             'servicing-parts-air-filter',   'c1000000-0000-0000-0000-000000000007', 2),
  ('c1000000-0000-0000-0000-000000000010', 'Spark Plugs',            'servicing-parts-spark-plugs',  'c1000000-0000-0000-0000-000000000007', 3),
  ('c1000000-0000-0000-0000-000000000011', 'Fuel Filter',            'servicing-parts-fuel-filter',  'c1000000-0000-0000-0000-000000000007', 4),
  ('c1000000-0000-0000-0000-000000000012', 'Timing Belts & Kits',    'servicing-parts-timing-belts', 'c1000000-0000-0000-0000-000000000007', 5),

  ('c1000000-0000-0000-0000-000000000013', 'Lubricants / Fluids',    'lubricants-fluids',        NULL, 3),
  ('c1000000-0000-0000-0000-000000000014', 'Engine Oil',             'lubricants-fluids-engine-oil',         'c1000000-0000-0000-0000-000000000013', 1),
  ('c1000000-0000-0000-0000-000000000015', 'Gear Oil & ATF',         'lubricants-fluids-gear-oil',           'c1000000-0000-0000-0000-000000000013', 2),
  ('c1000000-0000-0000-0000-000000000016', 'Brake Fluid & Coolant',  'lubricants-fluids-brake-fluid-coolant','c1000000-0000-0000-0000-000000000013', 3),

  ('c1000000-0000-0000-0000-000000000017', 'Tyres & Wheels',         'tyres-wheels',             NULL, 4),
  ('c1000000-0000-0000-0000-000000000018', 'Car Tyres',              'tyres-wheels-car-tyres',        'c1000000-0000-0000-0000-000000000017', 1),
  ('c1000000-0000-0000-0000-000000000019', 'Alloy Wheels & Hubcaps', 'tyres-wheels-alloy-wheels',     'c1000000-0000-0000-0000-000000000017', 2),

  ('c1000000-0000-0000-0000-000000000020', 'Electrical & Batteries', 'electrical-batteries',    NULL, 5),
  ('c1000000-0000-0000-0000-000000000021', 'Car Batteries',          'electrical-batteries-car-batteries',  'c1000000-0000-0000-0000-000000000020', 1),
  ('c1000000-0000-0000-0000-000000000022', 'Bulbs & Lighting',       'electrical-batteries-bulbs-lighting', 'c1000000-0000-0000-0000-000000000020', 2),
  ('c1000000-0000-0000-0000-000000000023', 'Alternators & Starters', 'electrical-batteries-alternators',    'c1000000-0000-0000-0000-000000000020', 3),

  ('c1000000-0000-0000-0000-000000000024', 'Car Accessories',        'car-accessories',          NULL, 6),
  ('c1000000-0000-0000-0000-000000000025', 'Interior Accessories',   'car-accessories-interior', 'c1000000-0000-0000-0000-000000000024', 1),
  ('c1000000-0000-0000-0000-000000000026', 'Exterior Accessories',   'car-accessories-exterior', 'c1000000-0000-0000-0000-000000000024', 2)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Brake & Wheel Hub/Bearings
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000001', 'BR-BOSCH-CAMRY-1217', 'bosch-quietcast-front-brake-pads-camry-2012-2017',
  'Bosch QuietCast Front Brake Pad Set — Toyota Camry 2012–2017',
  'Ceramic brake pads with multi-layer shim for quiet, low-dust braking.',
  'c1000000-0000-0000-0000-000000000002', 'Bosch', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/a9WQ17QfipfcDmnwqXSh3PcXcOuAv260MGeGL7HM.webp"]'::jsonb,
  '{"position":"Front","compound":"Ceramic","fitment":"Toyota Camry 2012-2017"}'::jsonb,
  '[{"title":"Quiet braking","text":"Multi-layer shim cuts squeal and vibration."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000002', 'BR-AKB-ACCORD-0812', 'akebono-proact-front-brake-pads-honda-accord-2008-2012',
  'Akebono ProACT Front Brake Pads — Honda Accord 2008–2012',
  'Ultra-premium ceramic pads engineered for fade resistance and silent stops.',
  'c1000000-0000-0000-0000-000000000002', 'Akebono', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/Vq5tbYDolM5eBjtfRam1Z22Z457jPpEnoIQlIgor.png"]'::jsonb,
  '{"position":"Front","compound":"Ultra-premium ceramic","fitment":"Honda Accord 2008-2012"}'::jsonb,
  '[{"title":"Fade resistant","text":"Maintains braking feel under hard repeated stops."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000003', 'BR-TOY-COROLLA-1419', 'toyota-oem-front-brake-pads-corolla-2014-2019',
  'Toyota OEM Front Brake Pad Set — Corolla 2014–2019',
  'Original Toyota front brake pads for factory stopping feel.',
  'c1000000-0000-0000-0000-000000000002', 'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/a9WQ17QfipfcDmnwqXSh3PcXcOuAv260MGeGL7HM.webp"]'::jsonb,
  '{"position":"Front","compound":"OEM ceramic","fitment":"Toyota Corolla 2014-2019"}'::jsonb,
  '[{"title":"OEM fitment","text":"Preserves Toyota factory braking balance."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000004', 'BR-BREMBO-ES350-0712', 'brembo-front-brake-pads-lexus-es350-2007-2012',
  'Brembo OE Replacement Front Brake Pads — Lexus ES350 2007–2012',
  'Race-derived compound tuned for strong bite and consistent fade resistance.',
  'c1000000-0000-0000-0000-000000000002', 'Brembo', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/czrShvbvzOpThyBV8K8kRlY6jPgPS6nXMLJNtBCn.png"]'::jsonb,
  '{"position":"Front","compound":"NAO ceramic","fitment":"Lexus ES350 2007-2012"}'::jsonb,
  '[{"title":"OE fitment","text":"Drop-in replacement, no bracket modification."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000005', 'BR-HUB-CAMRY-0717', 'toyota-camry-front-wheel-bearing-hub-2007-2017',
  'Front Wheel Bearing Hub Assembly — Toyota Camry 2007–2017',
  'Direct-fit hub with integrated ABS sensor ring for smooth ABS operation.',
  'c1000000-0000-0000-0000-000000000002', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/yi80Ugih9wZX4t4xrjpwb75Yhkq7lq4LJTWycKFO.jpg"]'::jsonb,
  '{"position":"Front","abs_ring":"Integrated","fitment":"Toyota Camry 2007-2017"}'::jsonb,
  '[{"title":"Plug-and-play","text":"Pre-assembled unit cuts install time."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000006', 'BR-ROTOR-ACCORD-0817', 'coated-front-brake-rotor-pair-honda-accord-2008-2017',
  'Coated Front Brake Rotor Pair — Honda Accord 2008–2017',
  'Zinc-coated rotors resist rust and match OE diameter and vane spec.',
  'c1000000-0000-0000-0000-000000000002', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/9K2Jl53jNafs2ENEcRQV4AJPQnqaPdGYOMqI5KIZ.png"]'::jsonb,
  '{"position":"Front","finish":"Zinc coated","fitment":"Honda Accord 2008-2017"}'::jsonb,
  '[{"title":"Anti-rust","text":"Zinc layer slows corrosion during storage."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000007', 'BR-ELANTRA-1120', 'front-brake-pads-hyundai-elantra-2011-2020',
  'Front Brake Pad Set — Hyundai Elantra 2011–2020',
  'Ceramic compound pads for everyday Elantra braking with low dust.',
  'c1000000-0000-0000-0000-000000000002', 'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/a9WQ17QfipfcDmnwqXSh3PcXcOuAv260MGeGL7HM.webp"]'::jsonb,
  '{"position":"Front","compound":"Ceramic","fitment":"Hyundai Elantra 2011-2020"}'::jsonb,
  '[{"title":"Low dust","text":"Reduces brake dust on alloy wheels."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000008', 'BR-SPORTAGE-1015', 'front-brake-pads-kia-sportage-2010-2015',
  'Front Brake Pad Set — Kia Sportage 2010–2015',
  'Ceramic pads sized for Sportage front calipers with consistent pedal feel.',
  'c1000000-0000-0000-0000-000000000002', 'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/Vq5tbYDolM5eBjtfRam1Z22Z457jPpEnoIQlIgor.png"]'::jsonb,
  '{"position":"Front","compound":"Ceramic","fitment":"Kia Sportage 2010-2015"}'::jsonb,
  '[{"title":"Consistent pedal","text":"Stable friction coefficient across temperature range."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Suspension Parts
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000009', 'SU-MONROE-CAMRY-0711', 'monroe-reflex-front-shocks-pair-camry-2007-2011',
  'Monroe Reflex Front Shock Absorbers — Toyota Camry 2007–2011 Pair',
  'Gas-charged shocks for controlled ride and reduced nose dive.',
  'c1000000-0000-0000-0000-000000000003', 'Monroe', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/GZlGBA4N3zcxWQ3kwwlJebzQgkbiUOyRODo0FUoD.jpg"]'::jsonb,
  '{"position":"Front","type":"Gas-charged","fitment":"Toyota Camry 2007-2011"}'::jsonb,
  '[{"title":"Dive control","text":"Reduces front-end dive under hard braking."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000010', 'SU-KYB-ACCORD-0812', 'kyb-excel-g-rear-shocks-pair-accord-2008-2012',
  'KYB Excel-G Rear Shock Absorbers — Honda Accord 2008–2012 Pair',
  'OES-matched valving for smooth comfort and stable rear control.',
  'c1000000-0000-0000-0000-000000000003', 'KYB', 'new', 'oes',
  '["https://autofactorng.com/images/products/l/GZlGBA4N3zcxWQ3kwwlJebzQgkbiUOyRODo0FUoD.jpg"]'::jsonb,
  '{"position":"Rear","type":"Gas-charged","fitment":"Honda Accord 2008-2012"}'::jsonb,
  '[{"title":"OES valving","text":"Restores original ride quality."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000011', 'SU-BJ-COROLLA-0919', 'front-lower-ball-joint-pair-corolla-2009-2019',
  'Front Lower Ball Joint Pair — Toyota Corolla 2009–2019',
  'Sealed ball joints restoring correct caster and steering feel.',
  'c1000000-0000-0000-0000-000000000003', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/YHv5AmGHYaqYObQc53LHUvaxPMbgXef5OnY0yAJV.png"]'::jsonb,
  '{"position":"Front lower","fitment":"Toyota Corolla 2009-2019"}'::jsonb,
  '[{"title":"Sealed joint","text":"Factory-style dust boots protect grease."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000012', 'SU-TIEROD-CIVIC-0615', 'outer-tie-rod-end-pair-civic-2006-2015',
  'Outer Tie Rod End Pair — Honda Civic 2006–2015',
  'Boot-sealed outer tie rods fixing steering looseness and wander.',
  'c1000000-0000-0000-0000-000000000003', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/rny2Jl9prw2eDNvLeNK2B4ITFkIQ9zw4zRmaCJ4M.jpg"]'::jsonb,
  '{"position":"Outer","fitment":"Honda Civic 2006-2015"}'::jsonb,
  '[{"title":"Steering tightness","text":"Removes play caused by worn joints."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000013', 'SU-SWAY-TOYOTA-1018', 'front-sway-bar-end-link-set-toyota-2010-2018',
  'Front Sway Bar / Stabilizer End Link Set — Toyota 2010–2018',
  'Reduces body roll and corner clunking on Camry, Corolla, and Avalon.',
  'c1000000-0000-0000-0000-000000000003', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/N90xXnVumAbbTt4gS13rrb1acNnllNwqYtgpXiOT.jpg"]'::jsonb,
  '{"position":"Front","fitment":"Toyota Camry, Corolla, Avalon 2010-2018"}'::jsonb,
  '[{"title":"Body roll control","text":"Fixes float and clunk from worn links."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000014', 'SU-CARM-SONATA-0615', 'front-control-arm-hyundai-sonata-2006-2015',
  'Front Control Arm — Hyundai Sonata 2006–2015',
  'Complete control arm with bushings for accurate wheel alignment.',
  'c1000000-0000-0000-0000-000000000003', 'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/YHv5AmGHYaqYObQc53LHUvaxPMbgXef5OnY0yAJV.png"]'::jsonb,
  '{"position":"Front","fitment":"Hyundai Sonata 2006-2015"}'::jsonb,
  '[{"title":"Alignment stability","text":"Worn bushings cause wander — this restores it."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Engine Parts
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000015', 'EN-TCK-2ARFE-1217', 'timing-chain-kit-2ar-fe-camry-2012-2017',
  'Timing Chain Kit (2AR-FE) — Toyota Camry 2012–2017',
  'Full kit: chain, guides, tensioner, and seals for complete service.',
  'c1000000-0000-0000-0000-000000000004', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"2AR-FE 2.5L","fitment":"Toyota Camry 2012-2017"}'::jsonb,
  '[{"title":"Complete kit","text":"All chain-drive components in one box."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000016', 'EN-VCG-K24-0307', 'valve-cover-gasket-set-k24-accord-2003-2007',
  'Valve Cover Gasket & Spark Plug Tube Seal Set (K24) — Honda Accord 2003–2007',
  'Complete seal set stopping oil seepage at the top end.',
  'c1000000-0000-0000-0000-000000000004', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"K24A2","fitment":"Honda Accord 2003-2007"}'::jsonb,
  '[{"title":"Leak-free top end","text":"Stops oil dripping onto the exhaust."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000017', 'EN-HGS-1MZFE-9703', 'head-gasket-set-1mz-fe-camry-es300-1997-2003',
  'Head Gasket Set (1MZ-FE) — Camry / ES300 / Sienna 1997–2003',
  'Full upper-engine gasket set for V6 head gasket jobs or overhauls.',
  'c1000000-0000-0000-0000-000000000004', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"1MZ-FE 3.0L V6","fitment":"Toyota Camry, Lexus ES300, Toyota Sienna 1997-2003"}'::jsonb,
  '[{"title":"Multiple applications","text":"Fits Camry, ES300, and Sienna of the era."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000018', 'EN-TBK-G4KC-0610', 'timing-belt-kit-g4kc-sonata-2006-2010',
  'Timing Belt Kit (G4KC 2.4L) — Hyundai Sonata 2006–2010',
  'Belt, tensioner, idler, and water pump for one-stop service.',
  'c1000000-0000-0000-0000-000000000004', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"G4KC 2.4L","fitment":"Hyundai Sonata 2006-2010"}'::jsonb,
  '[{"title":"Belt-plus-pump","text":"Replace both together to avoid reopening the job."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000019', 'EN-OPG-2AZFE', 'oil-pan-gasket-2az-fe-camry-rav4',
  'Oil Pan Gasket (2AZ-FE) — Toyota Camry / RAV4',
  'Steel-backed gasket stopping oil pan leaks from a cracked seal.',
  'c1000000-0000-0000-0000-000000000004', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"2AZ-FE 2.4L","fitment":"Toyota Camry 2002-2006, Toyota RAV4 2001-2005"}'::jsonb,
  '[{"title":"Stop leaks","text":"Fixes low-oil warnings from cracked gaskets."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000020', 'EN-MOUNT-CRV-0712', 'engine-mount-honda-crv-2007-2012',
  'Engine Mount — Honda CR-V 2007–2012',
  'Replacement mount reducing vibration and engine shift under load.',
  'c1000000-0000-0000-0000-000000000004', 'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Honda CR-V 2007-2012"}'::jsonb,
  '[{"title":"Vibration control","text":"Worn mounts cause clunks on gear shift."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Steering Parts
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000021', 'ST-ITR-CAMRY-1217', 'front-inner-tie-rod-end-pair-camry-2012-2017',
  'Front Inner Tie Rod End Pair — Toyota Camry 2012–2017',
  'Boot-sealed inner tie rods restoring precision steering.',
  'c1000000-0000-0000-0000-000000000005', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/YHv5AmGHYaqYObQc53LHUvaxPMbgXef5OnY0yAJV.png"]'::jsonb,
  '{"position":"Front inner","fitment":"Toyota Camry 2012-2017"}'::jsonb,
  '[{"title":"Steering precision","text":"Fixes shaking and wander from worn rods."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000022', 'ST-PSP-3GRFE-0611', 'power-steering-pump-3gr-fe-camry-v6-2006-2011',
  'Power Steering Pump (3GR-FE V6) — Toyota Camry 2006–2011',
  'Remanufactured pump restoring full assisted steering, leak-free.',
  'c1000000-0000-0000-0000-000000000005', 'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"engine":"3GR-FE V6","fitment":"Toyota Camry V6 2006-2011"}'::jsonb,
  '[{"title":"Remanufactured to spec","text":"Tested to OEM pressure and flow."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000023', 'ST-RACKBOOT-COROLLA-0308', 'steering-rack-boot-kit-corolla-2003-2008',
  'Steering Rack Boot Kit — Toyota Corolla 2003–2008',
  'Boot and clamp kit protecting rack-and-pinion internals from dust and water.',
  'c1000000-0000-0000-0000-000000000005', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"fitment":"Toyota Corolla 2003-2008"}'::jsonb,
  '[{"title":"Rack protection","text":"Replace before a torn boot causes damage."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000024', 'ST-PSP-ACCORD-0312', 'power-steering-pump-honda-accord-2003-2012',
  'Power Steering Pump — Honda Accord 2003–2012',
  'Remanufactured pump for quiet, reliable assisted steering.',
  'c1000000-0000-0000-0000-000000000005', 'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"fitment":"Honda Accord 2003-2012"}'::jsonb,
  '[{"title":"Restored assist","text":"Fixes heavy or unresponsive steering."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Exhaust System
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000025', 'EX-MUFFLER-CAMRY-0711', 'walker-quiet-flow-muffler-camry-2007-2011',
  'Walker Quiet-Flow Muffler — Toyota Camry 2007–2011',
  'Direct-fit stainless muffler, no cutting or welding required.',
  'c1000000-0000-0000-0000-000000000006', 'Walker', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Toyota Camry 2007-2011","install":"Bolt-on direct fit"}'::jsonb,
  '[{"title":"Bolt-on fit","text":"Slides onto factory flanges and clamps."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000026', 'EX-FLEX-ACCORD-0812', 'exhaust-flex-pipe-accord-2008-2012',
  'Exhaust Flex Pipe Section — Honda Accord 2008–2012',
  'Stainless mesh flex pipe fixing cracks and rattles from heat cycling.',
  'c1000000-0000-0000-0000-000000000006', 'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Honda Accord 2008-2012"}'::jsonb,
  '[{"title":"Stop rattles","text":"Quick bolt-on fix for cracked flex pipes."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000027', 'EX-CAT-COROLLA-0913', 'catalytic-converter-corolla-2009-2013',
  'Catalytic Converter — Toyota Corolla 2009–2013',
  'Direct-fit catalytic converter meeting OEM emission specs.',
  'c1000000-0000-0000-0000-000000000006', 'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Toyota Corolla 2009-2013"}'::jsonb,
  '[{"title":"Direct fit","text":"Bolts directly into the factory exhaust run."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Oil Filter
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000028', 'OF-TOY-90915YZZD4', 'toyota-genuine-oil-filter-90915-yzzd4',
  'Toyota Genuine Oil Filter (90915-YZZD4)',
  'OEM spin-on oil filter fitting most Toyota petrol engines.',
  'c1000000-0000-0000-0000-000000000008', 'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"90915-YZZD4"}'::jsonb,
  '[{"title":"OEM spec","text":"Same filter media as factory-installed unit."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000029', 'OF-HON-15400PLMA02', 'honda-genuine-oil-filter-15400-plm-a02',
  'Honda Genuine Oil Filter (15400-PLM-A02)',
  'OEM spin-on oil filter for Honda 4-cylinder petrol engines.',
  'c1000000-0000-0000-0000-000000000008', 'Honda', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"15400-PLM-A02"}'::jsonb,
  '[{"title":"OEM spec","text":"Direct factory replacement filter."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000030', 'OF-MANN-W712', 'mann-filter-oil-filter-w712',
  'MANN-FILTER Oil Filter W712',
  'German-made spin-on filter fitting Hyundai/Kia 4-cylinder engines.',
  'c1000000-0000-0000-0000-000000000008', 'MANN', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"W712","origin":"Germany"}'::jsonb,
  '[{"title":"German engineering","text":"Widely used as OEM supply across Asian brands."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Air Filter
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000031', 'AF-KN-332171', 'kn-high-flow-air-filter-toyota-camry-33-2171',
  'K&N High-Flow Drop-In Air Filter — Toyota Camry (33-2171)',
  'Washable, reusable filter improving airflow and throttle response.',
  'c1000000-0000-0000-0000-000000000009', 'K&N', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"33-2171","fitment":"Toyota Camry","washable":"Yes, lifetime filter"}'::jsonb,
  '[{"title":"Lifetime filter","text":"Wash and re-oil instead of replacing."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000032', 'AF-MANN-C25004', 'mann-filter-air-filter-c25004-accord-crv',
  'MANN-FILTER Air Filter C 25 004 — Honda Accord / CR-V',
  'German paper air filter protecting engine from dust and debris.',
  'c1000000-0000-0000-0000-000000000009', 'MANN', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"part_number":"C 25 004","fitment":"Honda Accord, Honda CR-V"}'::jsonb,
  '[{"title":"Multi-car fit","text":"Suits Accord sedan and CR-V of the same generation."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000033', 'AF-TOY-CAMRY-1217', 'toyota-oem-air-filter-camry-2012-2017',
  'Toyota OEM Engine Air Filter — Camry 2.5L (2012–2017)',
  'Flat panel element for easy scheduled service intervals.',
  'c1000000-0000-0000-0000-000000000009', 'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"engine":"2AR-FE 2.5L","fitment":"Toyota Camry 2012-2017"}'::jsonb,
  '[{"title":"Easy swap","text":"Sits in an accessible airbox, no tools required."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000034', 'AF-MANN-CU2842', 'mann-cabin-air-filter-hyundai-kia-cu2842',
  'MANN Cabin Air Filter CU 2842 — Hyundai / KIA',
  'Carbon-activated filter removing pollen, dust, and odours.',
  'c1000000-0000-0000-0000-000000000009', 'MANN', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"part_number":"CU 2842","type":"Carbon-activated","fitment":"Hyundai Sonata, Hyundai Tucson, Kia Sportage"}'::jsonb,
  '[{"title":"Carbon activated","text":"Reduces traffic-exhaust fumes in the cabin."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000035', 'AF-LEX-ES350-0712', 'air-filter-lexus-es350-2007-2012',
  'Engine Air Filter — Lexus ES350 2007–2012',
  'Direct replacement panel filter for the ES350 3.5L V6.',
  'c1000000-0000-0000-0000-000000000009', 'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"fitment":"Lexus ES350 2007-2012"}'::jsonb,
  '[{"title":"OEM fit","text":"Matches factory airbox dimensions exactly."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Spark Plugs
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000036', 'SP-NGK-ILZKR7B11', 'ngk-iridium-ix-spark-plugs-camry-2012-2017',
  'NGK Iridium IX Spark Plugs — Set of 4 (Toyota Camry 2012–2017)',
  'Fine-wire iridium plugs for better ignitability and fuel economy.',
  'c1000000-0000-0000-0000-000000000010', 'NGK', 'new', 'oem',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"ILZKR7B-11","quantity":"Set of 4","fitment":"Toyota Camry 2.5L 2012-2017"}'::jsonb,
  '[{"title":"Long service life","text":"Iridium plugs last up to 100,000 km."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000037', 'SP-BOSCH-9652', 'bosch-double-iridium-spark-plugs-accord-2003-2007',
  'Bosch Double Iridium Spark Plugs — Set of 4 (Honda Accord 2003–2007)',
  'Double iridium tips for faster throttle response and long life.',
  'c1000000-0000-0000-0000-000000000010', 'Bosch', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"9652","quantity":"Set of 4","fitment":"Honda Accord 2.4L 2003-2007"}'::jsonb,
  '[{"title":"Double iridium","text":"Both electrodes tipped for longer life."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000038', 'SP-DENSO-IXU22', 'denso-iridium-power-spark-plugs-corolla',
  'Denso Iridium Power Spark Plugs — Set of 4 (Toyota Corolla)',
  'Japanese Denso plugs with fine tip for cleaner combustion.',
  'c1000000-0000-0000-0000-000000000010', 'Denso', 'new', 'oem',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"IXU22","quantity":"Set of 4","fitment":"Toyota Corolla 1.8L"}'::jsonb,
  '[{"title":"Denso OEM quality","text":"Denso supplies plugs as Toyota factory equipment."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000039', 'SP-CHAMP-9801', 'champion-platinum-spark-plugs-elantra-cerato',
  'Champion Platinum Spark Plugs — Set of 4 (Hyundai Elantra / Kia Cerato)',
  'Platinum-tipped plugs with longer change intervals.',
  'c1000000-0000-0000-0000-000000000010', 'Champion', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"quantity":"Set of 4","fitment":"Hyundai Elantra, Kia Cerato 1.6L/2.0L"}'::jsonb,
  '[{"title":"Platinum durability","text":"Holds its edge longer than nickel plugs."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Fuel Filter
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000040', 'FF-TOY-2330074330', 'toyota-genuine-fuel-filter-camry-corolla',
  'Toyota Genuine Inline Fuel Filter — Camry / Corolla',
  'OEM canister filter replaced every 80,000 km service.',
  'c1000000-0000-0000-0000-000000000011', 'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"23300-74330","fitment":"Toyota Camry, Toyota Corolla"}'::jsonb,
  '[{"title":"Clean fuel flow","text":"Traps rust and sediment before injectors."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000041', 'FF-BOSCH-N2064', 'bosch-n2064-fuel-filter-accord-2003-2007',
  'Bosch N2064 Fuel Filter — Honda Accord 2.4L (2003–2007)',
  'Two-stage paper element stopping varnish and particulates.',
  'c1000000-0000-0000-0000-000000000011', 'Bosch', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"N2064","fitment":"Honda Accord 2.4L 2003-2007"}'::jsonb,
  '[{"title":"Two-stage filtration","text":"Coarse and fine layers for thorough removal."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Timing Belts & Kits
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000042', 'TB-GATES-TCK170', 'gates-timing-belt-kit-accord-f23a-1998-2002',
  'Gates PowerGrip Timing Belt Kit — Honda Accord F23A (1998–2002)',
  'Belt, tensioner, idler, and water pump for one-stop service.',
  'c1000000-0000-0000-0000-000000000012', 'Gates', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"TCK170","engine":"F23A 2.3L","fitment":"Honda Accord 1998-2002"}'::jsonb,
  '[{"title":"Complete kit","text":"All four components in one Gates box."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000043', 'TB-DAYCO-95333K1', 'dayco-timing-belt-kit-camry-5s-fe-1992-2001',
  'Dayco Timing Belt Kit — Toyota Camry 5S-FE 2.2L (1992–2001)',
  'Belt and tensioner kit keeping older Camry engines reliable.',
  'c1000000-0000-0000-0000-000000000012', 'Dayco', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"engine":"5S-FE 2.2L","fitment":"Toyota Camry 1992-2001"}'::jsonb,
  '[{"title":"Service timing","text":"Belt is due every 90,000 km."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Engine Oil (universal)
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000044', 'OIL-MOBIL1-5W30-4L', 'mobil-1-5w-30-full-synthetic-engine-oil-4l',
  'Mobil 1 5W-30 Full Synthetic Engine Oil — 4 Litres',
  'Full synthetic engine oil for extended performance and engine cleanliness.',
  'c1000000-0000-0000-0000-000000000014', 'Mobil', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/j5RTR0vGQ1AiPcmZB2ctAGQIZXY5wNt0nZAvqGVo.png"]'::jsonb,
  '{"viscosity":"5W-30","volume":"4 litres","type":"Full synthetic"}'::jsonb,
  '[{"title":"Full synthetic","text":"Extended drain intervals and engine cleanliness."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000045', 'OIL-CASTROL-GTX-20W50-4L', 'castrol-gtx-20w-50-engine-oil-4l',
  'Castrol GTX 20W-50 Engine Oil — 4 Litres',
  'High-mileage mineral oil suited to hot climate daily driving.',
  'c1000000-0000-0000-0000-000000000014', 'Castrol', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/7tAnQviz9VjOgUIxRaRUWJUVFSWKmfnmbYoglmZm.png"]'::jsonb,
  '{"viscosity":"20W-50","volume":"4 litres","type":"Mineral"}'::jsonb,
  '[{"title":"Hot climate suited","text":"Higher viscosity grade for tropical conditions."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000046', 'OIL-TOTAL-QUARTZ-5000-5W40-4L', 'total-quartz-5000-5w-40-engine-oil-4l',
  'Total Quartz 5000 5W-40 Engine Oil — 4 Litres',
  'Semi-synthetic oil balancing protection and value for daily use.',
  'c1000000-0000-0000-0000-000000000014', 'Total', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/Dfvf4kHQl4JVSvOUQgYN0px5R9din8y9l40DZ1Ja.webp"]'::jsonb,
  '{"viscosity":"5W-40","volume":"4 litres","type":"Semi-synthetic"}'::jsonb,
  '[{"title":"Balanced protection","text":"Good wear protection at an everyday price point."}]'::jsonb, true
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Gear Oil & ATF (universal)
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000047', 'ATF-TOY-WS-4L', 'toyota-atf-ws-automatic-transmission-fluid-4l',
  'Toyota ATF WS Automatic Transmission Fluid — 4 Litres',
  'World Standard ATF preventing shudder and slipping in Toyota/Lexus autos.',
  'c1000000-0000-0000-0000-000000000015', 'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/j5RTR0vGQ1AiPcmZB2ctAGQIZXY5wNt0nZAvqGVo.png"]'::jsonb,
  '{"specification":"ATF-WS","volume":"4 litres"}'::jsonb,
  '[{"title":"Anti-shudder formula","text":"Keeps clutch packs engaging smoothly."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000048', 'ATF-SHELL-SPIRAX-S4-1L', 'shell-spirax-s4-atf-full-synthetic-1l',
  'Shell Spirax S4 ATF Full Synthetic Transmission Fluid — 1 Litre',
  'High-performance synthetic ATF for multi-make automatic gearboxes.',
  'c1000000-0000-0000-0000-000000000015', 'Shell', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/7tAnQviz9VjOgUIxRaRUWJUVFSWKmfnmbYoglmZm.png"]'::jsonb,
  '{"specification":"Dexron VI / Mercon LV compatible","volume":"1 litre"}'::jsonb,
  '[{"title":"Multi-vehicle spec","text":"Covers Dexron VI, Mercon LV, and Dexron III."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000049', 'ATF-CASTROL-TRANSMAX-1L', 'castrol-transmax-atf-dex-merc-1l',
  'Castrol Transmax ATF Dex/Merc Multivehicle — 1 Litre',
  'Dex/Merc ATF for older automatic transmissions across major brands.',
  'c1000000-0000-0000-0000-000000000015', 'Castrol', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/Dfvf4kHQl4JVSvOUQgYN0px5R9din8y9l40DZ1Ja.webp"]'::jsonb,
  '{"specification":"Dexron III / Mercon","volume":"1 litre"}'::jsonb,
  '[{"title":"Broad compatibility","text":"Covers a wide range of older automatic gearboxes."}]'::jsonb, true
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Brake Fluid & Coolant (universal)
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000050', 'BF-ATE-TYP200-DOT4-500ML', 'ate-typ-200-dot-4-brake-fluid-500ml',
  'ATE TYP 200 DOT 4 Brake Fluid — 500 ml',
  'High wet-boiling-point fluid resisting vapour lock and fade.',
  'c1000000-0000-0000-0000-000000000016', 'ATE', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/XVyuLyp1izSHnlblXXdvplQkVbexPRmELSr90X6L.jpg"]'::jsonb,
  '{"specification":"DOT 4","volume":"500 ml"}'::jsonb,
  '[{"title":"High boiling point","text":"Prevents vapour lock under hard braking."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000051', 'CL-PRESTONE-5050-378L', 'prestone-50-50-coolant-antifreeze-3-78l',
  'Prestone 50/50 Coolant & Antifreeze — 3.78 Litres (All Vehicles)',
  'Ready-to-use premix coolant preventing overheating and corrosion.',
  'c1000000-0000-0000-0000-000000000016', 'Prestone', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/XVyuLyp1izSHnlblXXdvplQkVbexPRmELSr90X6L.jpg"]'::jsonb,
  '{"type":"50/50 premix","volume":"3.78 litres"}'::jsonb,
  '[{"title":"Ready to pour","text":"No measuring or mixing needed."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000052', 'CL-TOY-SLLC-PINK-2L', 'toyota-super-long-life-coolant-pink-2l',
  'Toyota Super Long Life Coolant (Pink) — 2 Litres Concentrate',
  'SLLC concentrate giving 5-year protection when mixed 1:1 with water.',
  'c1000000-0000-0000-0000-000000000016', 'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/category/XVyuLyp1izSHnlblXXdvplQkVbexPRmELSr90X6L.jpg"]'::jsonb,
  '{"type":"Concentrate","volume":"2 litres","service_life":"5 years or 160,000 km"}'::jsonb,
  '[{"title":"Toyota OEM spec","text":"Required fluid for Camry, RAV4, Corolla, and Lexus."}]'::jsonb, true
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Car Tyres
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000053', 'TY-BRIDGE-EP150-18565R15', 'bridgestone-ecopia-ep150-185-65r15-tyre',
  'Bridgestone Ecopia EP150 — 185/65 R15 (Single)',
  'Fuel-efficient touring tyre for compact sedans and hatchbacks.',
  'c1000000-0000-0000-0000-000000000018', 'Bridgestone', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"185/65 R15","load_rating":"88H"}'::jsonb,
  '[{"title":"Fuel saver","text":"Lower rolling resistance cuts fuel cost."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000054', 'TY-MICH-XM2-19565R15', 'michelin-energy-xm2-195-65r15-tyre',
  'Michelin Energy XM2 — 195/65 R15 (Single)',
  'Long-life tyre with strong wet grip for mid-size sedans.',
  'c1000000-0000-0000-0000-000000000018', 'Michelin', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"195/65 R15","load_rating":"91H"}'::jsonb,
  '[{"title":"Michelin longevity","text":"Slow wear, lower cost-per-km than budget tyres."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000055', 'TY-DUNLOP-SP200E-20560R16', 'dunlop-sp-sport-200e-205-60r16-tyre',
  'Dunlop SP Sport 200E — 205/60 R16 (Single)',
  'Sport touring tyre balancing cornering grip and ride comfort.',
  'c1000000-0000-0000-0000-000000000018', 'Dunlop', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"205/60 R16","load_rating":"92V"}'::jsonb,
  '[{"title":"Sport touring balance","text":"Handles rough tarmac and expressway cruising."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000056', 'TY-CONTI-CP-21555R17', 'continental-contipower-215-55r17-tyre',
  'Continental ContiPower — 215/55 R17 (Single)',
  'All-round performance tyre for larger sedans and crossovers.',
  'c1000000-0000-0000-0000-000000000018', 'Continental', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"215/55 R17","load_rating":"94V"}'::jsonb,
  '[{"title":"All-round grip","text":"Balanced dry/wet performance for daily driving."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Alloy Wheels & Hubcaps (universal)
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000057', 'WH-ALLOY-16IN', 'alloy-wheel-rim-16-inch',
  '16" Alloy Wheel Rim',
  'Lightweight alloy rim for sedans and compact crossovers.',
  'c1000000-0000-0000-0000-000000000019', 'Generic', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"diameter":"16 inch"}'::jsonb,
  '[{"title":"Lightweight","text":"Reduces unsprung weight versus steel rims."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000058', 'WH-ALLOY-17IN', 'alloy-wheel-rim-17-inch',
  '17" Alloy Wheel Rim',
  'Lightweight alloy rim for mid-size sedans and SUVs.',
  'c1000000-0000-0000-0000-000000000019', 'Generic', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"diameter":"17 inch"}'::jsonb,
  '[{"title":"Lightweight","text":"Reduces unsprung weight versus steel rims."}]'::jsonb, true
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Car Batteries
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000059', 'BAT-BOSCH-S4008', 'bosch-s4-008-car-battery-74ah-680cca',
  'Bosch S4 008 Car Battery — 74Ah 680CCA',
  'Maintenance-free battery with strong cold-cranking amps.',
  'c1000000-0000-0000-0000-000000000021', 'Bosch', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"capacity":"74Ah","cca":"680A","fitment":"Toyota Camry, Honda Accord, Lexus ES350, Ford Explorer"}'::jsonb,
  '[{"title":"680 cold-cranking amps","text":"Reliable starts even after sitting overnight."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000060', 'BAT-EXIDE-EC700', 'exide-excell-ec700-70ah-car-battery',
  'Exide Excell EC700 Car Battery — 70Ah 640CCA',
  'Sealed, spill-proof lead-acid battery, factory-charged and ready to install.',
  'c1000000-0000-0000-0000-000000000021', 'Exide', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"capacity":"70Ah","cca":"640A","fitment":"Hyundai Sonata, Kia Sportage, Toyota Corolla"}'::jsonb,
  '[{"title":"Ready to install","text":"Factory-charged and sealed."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000061', 'BAT-AMARON-45D23L', 'amaron-hi-life-45d23l-65ah-battery',
  'Amaron Hi-Life 45D23L Car Battery — 65Ah',
  'Battery built for tropical heat, vibration, and deep discharge cycles.',
  'c1000000-0000-0000-0000-000000000021', 'Amaron', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"capacity":"65Ah","terminal":"JIS","fitment":"Toyota Corolla, Honda Civic, Honda Accord"}'::jsonb,
  '[{"title":"Tropical design","text":"Built for hot climates where conventional batteries fail early."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Bulbs & Lighting (universal — fit by socket type)
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000062', 'LT-OSRAM-NBL-H4', 'osram-night-breaker-laser-h4-headlight-bulbs',
  'OSRAM Night Breaker Laser H4 Headlight Bulbs — Twin Pack',
  'Up to 150% more light than standard halogen bulbs.',
  'c1000000-0000-0000-0000-000000000022', 'OSRAM', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"base":"H4","quantity":"Twin pack","certification":"ECE approved"}'::jsonb,
  '[{"title":"150% more light","text":"Brighter beam for safer night driving."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000063', 'LT-PHILIPS-CV-H7', 'philips-crystal-vision-ultra-h7-headlight-bulbs',
  'Philips Crystal Vision Ultra H7 Headlight Bulbs — Twin Pack (4300K)',
  'Crisp white light improving road sign and marking visibility.',
  'c1000000-0000-0000-0000-000000000022', 'Philips', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"base":"H7","colour_temperature":"4300K","quantity":"Twin pack"}'::jsonb,
  '[{"title":"4300K white light","text":"Closer to daylight than yellow halogens."}]'::jsonb, true
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Alternators & Starters
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000064', 'AL-TOY-2GRFE-0711', 'remanufactured-alternator-2gr-fe-camry-v6-2007-2011',
  'Remanufactured Alternator (2GR-FE V6) — Toyota Camry 2007–2011',
  'Load-tested alternator, direct bolt-in replacement.',
  'c1000000-0000-0000-0000-000000000023', 'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"2GR-FE 3.5L V6","output":"150A","fitment":"Toyota Camry V6 2007-2011"}'::jsonb,
  '[{"title":"Load-tested","text":"Output verified before shipping."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000065', 'ST-HON-K24-0307', 'remanufactured-starter-motor-k24-accord-2003-2007',
  'Remanufactured Starter Motor (K24) — Honda Accord 2003–2007',
  'Solenoid-tested rebuild with new brushes for reliable cranking.',
  'c1000000-0000-0000-0000-000000000023', 'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"K24A2 2.4L","fitment":"Honda Accord 2003-2007"}'::jsonb,
  '[{"title":"No-start fix","text":"Solves slow cranking or click-no-start issues."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Interior Accessories
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000066', 'AC-MAT-CAMRY-1217', 'all-weather-floor-mats-camry-2012-2017',
  'All-Weather Rubber Floor Mats — Toyota Camry (2012–2017) Set of 4',
  'Heavy-duty rubber mats trapping mud, water, and dust.',
  'c1000000-0000-0000-0000-000000000025', 'Generic', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Toyota Camry 2012-2017","quantity":"Set of 4"}'::jsonb,
  '[{"title":"Custom fit","text":"Contoured channels prevent shifting under pedals."}]'::jsonb, false
),
(
  'd1000000-0000-0000-0000-000000000067', 'AC-MAT-ACCORD-0812', 'all-weather-floor-mats-accord-2008-2012',
  'All-Weather Rubber Floor Mats — Honda Accord (2008–2012) Set of 4',
  'Heavy-duty rubber mats for daily Nigerian road conditions.',
  'c1000000-0000-0000-0000-000000000025', 'Generic', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Honda Accord 2008-2012","quantity":"Set of 4"}'::jsonb,
  '[{"title":"Easy to clean","text":"Hose down or brush off, no carpet staining."}]'::jsonb, false
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- PARTS — Exterior Accessories (universal)
-- --------------------------------------------------------
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features, is_universal) VALUES
(
  'd1000000-0000-0000-0000-000000000068', 'AC-CARCOVER-L', 'universal-waterproof-car-cover-large',
  'Universal Waterproof Car Cover — Large',
  'All-weather outdoor cover for sedans and medium SUVs.',
  'c1000000-0000-0000-0000-000000000026', 'Motoka', 'new', 'aftermarket',
  '["https://placehold.co/400x300?text=Car+Cover"]'::jsonb,
  '{"material":"190T polyester","size":"Large (up to 4.8m)"}'::jsonb,
  '[{"title":"Waterproof","text":"Keeps out rain, dust, and UV rays."}]'::jsonb, true
),
(
  'd1000000-0000-0000-0000-000000000069', 'AC-WIPER-SET', 'universal-windscreen-wiper-blades-set',
  'Universal Windscreen Wiper Blade Set',
  'Streak-free wiper blades fitting most standard hook-arm windscreens.',
  'c1000000-0000-0000-0000-000000000026', 'Bosch', 'new', 'aftermarket',
  '["https://placehold.co/400x300?text=Wiper+Blades"]'::jsonb,
  '{"fit":"Standard hook-arm"}'::jsonb,
  '[{"title":"Streak-free wipe","text":"Graphite-coated rubber for clear visibility."}]'::jsonb, true
)
ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- INVENTORY — one row per part
-- --------------------------------------------------------
INSERT INTO public.ladipo_part_inventory (part_id, price_kobo, stock_qty, seller_label) VALUES
  ('d1000000-0000-0000-0000-000000000001',  6500000, 12, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000002',  8200000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000003',  5500000, 10, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000004',  9800000,  6, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000005',  4200000, 14, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000006',  5800000, 10, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000007',  4800000, 10, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000008',  5000000,  8, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000009', 14000000,  6, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000010', 13000000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000011',  2200000, 14, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000012',  2800000, 12, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000013',  1800000, 16, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000014',  3500000, 10, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000015', 18500000,  4, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000016',  3800000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000017',  7200000,  6, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000018', 12500000,  4, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000019',  1800000, 12, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000020',  3200000,  8, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000021',  3200000, 10, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000022', 28000000,  3, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000023',  1500000, 14, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000024', 22000000,  4, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000025',  8500000,  6, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000026',  4200000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000027',  9500000,  5, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000028',   450000, 50, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000029',   420000, 50, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000030',   500000, 40, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000031',  5500000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000032',  1800000, 16, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000033',  1500000, 20, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000034',  1200000, 18, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000035',  2000000, 12, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000036',  4800000, 12, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000037',  5200000, 10, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000038',  4500000, 12, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000039',  3200000, 14, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000040',  1800000, 16, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000041',  2200000, 12, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000042', 14500000,  4, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000043',  9800000,  6, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000044',  3800000, 24, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000045',  2200000, 30, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000046',  2800000, 26, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000047',  7500000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000048',  2800000, 14, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000049',  2200000, 16, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000050',  1500000, 18, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000051',  3800000, 12, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000052',  4500000, 10, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000053',  3800000, 20, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000054',  5200000, 16, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000055',  5800000, 14, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000056',  6200000, 12, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000057',  6500000, 10, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000058',  7800000,  8, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000059', 38000000,  6, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000060', 32000000,  8, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000061', 28000000, 10, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000062',  2800000, 14, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000063',  3200000, 12, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000064', 55000000,  3, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000065', 35000000,  4, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000066',  1800000, 20, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000067',  1800000, 18, 'Motoka'),

  ('d1000000-0000-0000-0000-000000000068',  1800000, 24, 'Motoka'),
  ('d1000000-0000-0000-0000-000000000069',  1200000, 30, 'Motoka')
ON CONFLICT DO NOTHING;


-- --------------------------------------------------------
-- COMPATIBILITY — real make/model/year rows so car-based
-- filtering in ladipo.service.js actually matches parts.
-- Universal parts (is_universal = true) need no rows here —
-- getParts() already includes them for any selected car.
-- --------------------------------------------------------
INSERT INTO public.ladipo_part_compatibility (part_id, make, model, year_min, year_max) VALUES
  -- Brake & Wheel Hub
  ('d1000000-0000-0000-0000-000000000001', 'Toyota', 'Camry', 2012, 2017),
  ('d1000000-0000-0000-0000-000000000002', 'Honda', 'Accord', 2008, 2012),
  ('d1000000-0000-0000-0000-000000000003', 'Toyota', 'Corolla', 2014, 2019),
  ('d1000000-0000-0000-0000-000000000004', 'Lexus', 'ES350', 2007, 2012),
  ('d1000000-0000-0000-0000-000000000005', 'Toyota', 'Camry', 2007, 2017),
  ('d1000000-0000-0000-0000-000000000006', 'Honda', 'Accord', 2008, 2017),
  ('d1000000-0000-0000-0000-000000000007', 'Hyundai', 'Elantra', 2011, 2020),
  ('d1000000-0000-0000-0000-000000000008', 'Kia', 'Sportage', 2010, 2015),

  -- Suspension
  ('d1000000-0000-0000-0000-000000000009', 'Toyota', 'Camry', 2007, 2011),
  ('d1000000-0000-0000-0000-000000000010', 'Honda', 'Accord', 2008, 2012),
  ('d1000000-0000-0000-0000-000000000011', 'Toyota', 'Corolla', 2009, 2019),
  ('d1000000-0000-0000-0000-000000000012', 'Honda', 'Civic', 2006, 2015),
  ('d1000000-0000-0000-0000-000000000013', 'Toyota', 'Camry', 2010, 2018),
  ('d1000000-0000-0000-0000-000000000013', 'Toyota', 'Corolla', 2010, 2018),
  ('d1000000-0000-0000-0000-000000000013', 'Toyota', 'Avalon', 2010, 2018),
  ('d1000000-0000-0000-0000-000000000014', 'Hyundai', 'Sonata', 2006, 2015),

  -- Engine Parts
  ('d1000000-0000-0000-0000-000000000015', 'Toyota', 'Camry', 2012, 2017),
  ('d1000000-0000-0000-0000-000000000016', 'Honda', 'Accord', 2003, 2007),
  ('d1000000-0000-0000-0000-000000000017', 'Toyota', 'Camry', 1997, 2003),
  ('d1000000-0000-0000-0000-000000000017', 'Lexus', 'ES300', 1997, 2003),
  ('d1000000-0000-0000-0000-000000000017', 'Toyota', 'Sienna', 1997, 2003),
  ('d1000000-0000-0000-0000-000000000018', 'Hyundai', 'Sonata', 2006, 2010),
  ('d1000000-0000-0000-0000-000000000019', 'Toyota', 'Camry', 2002, 2006),
  ('d1000000-0000-0000-0000-000000000019', 'Toyota', 'RAV4', 2001, 2005),
  ('d1000000-0000-0000-0000-000000000020', 'Honda', 'CR-V', 2007, 2012),

  -- Steering
  ('d1000000-0000-0000-0000-000000000021', 'Toyota', 'Camry', 2012, 2017),
  ('d1000000-0000-0000-0000-000000000022', 'Toyota', 'Camry', 2006, 2011),
  ('d1000000-0000-0000-0000-000000000023', 'Toyota', 'Corolla', 2003, 2008),
  ('d1000000-0000-0000-0000-000000000024', 'Honda', 'Accord', 2003, 2012),

  -- Exhaust
  ('d1000000-0000-0000-0000-000000000025', 'Toyota', 'Camry', 2007, 2011),
  ('d1000000-0000-0000-0000-000000000026', 'Honda', 'Accord', 2008, 2012),
  ('d1000000-0000-0000-0000-000000000027', 'Toyota', 'Corolla', 2009, 2013),

  -- Oil Filter (model-only rows, no year limit — broad brand fitment)
  ('d1000000-0000-0000-0000-000000000028', 'Toyota', 'Camry', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000028', 'Toyota', 'Corolla', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000028', 'Toyota', 'RAV4', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000028', 'Toyota', 'Highlander', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000028', 'Toyota', 'Avalon', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000029', 'Honda', 'Accord', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000029', 'Honda', 'Civic', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000029', 'Honda', 'CR-V', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000030', 'Hyundai', 'Sonata', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000030', 'Hyundai', 'Elantra', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000030', 'Kia', 'Sportage', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000030', 'Kia', 'Cerato', NULL, NULL),

  -- Air Filter
  ('d1000000-0000-0000-0000-000000000031', 'Toyota', 'Camry', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000032', 'Honda', 'Accord', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000032', 'Honda', 'CR-V', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000033', 'Toyota', 'Camry', 2012, 2017),
  ('d1000000-0000-0000-0000-000000000034', 'Hyundai', 'Sonata', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000034', 'Hyundai', 'Tucson', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000034', 'Kia', 'Sportage', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000035', 'Lexus', 'ES350', 2007, 2012),

  -- Spark Plugs
  ('d1000000-0000-0000-0000-000000000036', 'Toyota', 'Camry', 2012, 2017),
  ('d1000000-0000-0000-0000-000000000037', 'Honda', 'Accord', 2003, 2007),
  ('d1000000-0000-0000-0000-000000000038', 'Toyota', 'Corolla', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000039', 'Hyundai', 'Elantra', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000039', 'Kia', 'Cerato', NULL, NULL),

  -- Fuel Filter
  ('d1000000-0000-0000-0000-000000000040', 'Toyota', 'Camry', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000040', 'Toyota', 'Corolla', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000041', 'Honda', 'Accord', 2003, 2007),

  -- Timing Belts
  ('d1000000-0000-0000-0000-000000000042', 'Honda', 'Accord', 1998, 2002),
  ('d1000000-0000-0000-0000-000000000043', 'Toyota', 'Camry', 1992, 2001),

  -- Car Tyres (compatible models for the size)
  ('d1000000-0000-0000-0000-000000000053', 'Toyota', 'Corolla', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000053', 'Honda', 'Civic', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000053', 'Hyundai', 'Elantra', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000054', 'Toyota', 'Camry', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000054', 'Honda', 'Accord', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000054', 'Hyundai', 'Sonata', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000055', 'Toyota', 'Camry', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000055', 'Lexus', 'ES350', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000055', 'Honda', 'Accord', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000056', 'Honda', 'Accord', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000056', 'Hyundai', 'Sonata', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000056', 'Kia', 'Sportage', NULL, NULL),

  -- Car Batteries
  ('d1000000-0000-0000-0000-000000000059', 'Toyota', 'Camry', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000059', 'Honda', 'Accord', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000059', 'Lexus', 'ES350', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000059', 'Ford', 'Explorer', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000060', 'Hyundai', 'Sonata', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000060', 'Kia', 'Sportage', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000060', 'Toyota', 'Corolla', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000061', 'Toyota', 'Corolla', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000061', 'Honda', 'Civic', NULL, NULL),
  ('d1000000-0000-0000-0000-000000000061', 'Honda', 'Accord', NULL, NULL),

  -- Alternators & Starters
  ('d1000000-0000-0000-0000-000000000064', 'Toyota', 'Camry', 2007, 2011),
  ('d1000000-0000-0000-0000-000000000065', 'Honda', 'Accord', 2003, 2007),

  -- Interior Accessories
  ('d1000000-0000-0000-0000-000000000066', 'Toyota', 'Camry', 2012, 2017),
  ('d1000000-0000-0000-0000-000000000067', 'Honda', 'Accord', 2008, 2012)
ON CONFLICT DO NOTHING;
