-- =============================================
-- Migration 063: Ladipo Expanded Catalog
-- Adds 7 new sub/top-level categories and ~50 more products
-- covering air filters, spark plugs, fuel filters, timing belts,
-- gear/ATF, brake fluid/coolant, tyres, batteries, lighting,
-- alternators, and extended engine/steering/exhaust lines.
-- =============================================

-- --------------------------------------------------------
-- NEW CATEGORIES
-- --------------------------------------------------------

INSERT INTO public.ladipo_categories (id, name, slug, parent_id, sort_order) VALUES

  -- Under Spare Parts
  ('a2000000-0000-0000-0000-000000000013', 'Engine Parts',    'spare-parts-engine-parts',    'a2000000-0000-0000-0000-000000000001', 3),
  ('a2000000-0000-0000-0000-000000000014', 'Steering Parts',  'spare-parts-steering-parts',  'a2000000-0000-0000-0000-000000000001', 4),
  ('a2000000-0000-0000-0000-000000000015', 'Exhaust System',  'spare-parts-exhaust-system',  'a2000000-0000-0000-0000-000000000001', 5),

  -- Under Servicing Parts
  ('a2000000-0000-0000-0000-000000000022', 'Air Filter',         'servicing-parts-air-filter',      'a2000000-0000-0000-0000-000000000002', 2),
  ('a2000000-0000-0000-0000-000000000023', 'Spark Plugs',        'servicing-parts-spark-plugs',     'a2000000-0000-0000-0000-000000000002', 3),
  ('a2000000-0000-0000-0000-000000000024', 'Fuel Filter',        'servicing-parts-fuel-filter',     'a2000000-0000-0000-0000-000000000002', 4),
  ('a2000000-0000-0000-0000-000000000025', 'Timing Belts & Kits','servicing-parts-timing-belts',    'a2000000-0000-0000-0000-000000000002', 5),

  -- Under Lubricants / Fluids
  ('a2000000-0000-0000-0000-000000000032', 'Gear Oil & ATF',         'lubricants-fluids-gear-oil',          'a2000000-0000-0000-0000-000000000003', 2),
  ('a2000000-0000-0000-0000-000000000033', 'Brake Fluid & Coolant',  'lubricants-fluids-brake-fluid-coolant','a2000000-0000-0000-0000-000000000003', 3),

  -- New top-level categories
  ('a2000000-0000-0000-0000-000000000004', 'Tyres & Wheels',       'tyres-wheels',        null, 4),
  ('a2000000-0000-0000-0000-000000000041', 'Car Tyres',            'tyres-wheels-car-tyres',         'a2000000-0000-0000-0000-000000000004', 1),
  ('a2000000-0000-0000-0000-000000000042', 'Alloy Wheels & Hubcaps','tyres-wheels-alloy-wheels',     'a2000000-0000-0000-0000-000000000004', 2),

  ('a2000000-0000-0000-0000-000000000005', 'Electrical & Batteries','electrical-batteries',  null, 5),
  ('a2000000-0000-0000-0000-000000000051', 'Car Batteries',         'electrical-batteries-car-batteries',     'a2000000-0000-0000-0000-000000000005', 1),
  ('a2000000-0000-0000-0000-000000000052', 'Bulbs & Lighting',      'electrical-batteries-bulbs-lighting',    'a2000000-0000-0000-0000-000000000005', 2),
  ('a2000000-0000-0000-0000-000000000053', 'Alternators & Starters','electrical-batteries-alternators',       'a2000000-0000-0000-0000-000000000005', 3),

  ('a2000000-0000-0000-0000-000000000006', 'Car Accessories',   'car-accessories',    null, 6),
  ('a2000000-0000-0000-0000-000000000061', 'Interior Accessories','car-accessories-interior',  'a2000000-0000-0000-0000-000000000006', 1),
  ('a2000000-0000-0000-0000-000000000062', 'Exterior Accessories','car-accessories-exterior',  'a2000000-0000-0000-0000-000000000006', 2)

ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- NEW PRODUCTS
-- --------------------------------------------------------

INSERT INTO public.ladipo_parts (
  id, sku, slug, name, description,
  category_id, brand, condition, part_type,
  images, specifications, key_features, is_universal
) VALUES

-- ===================== BRAKE & WHEEL HUB =====================

(
  'b2000000-0000-0000-0000-000000000021',
  'AF-BOSCH-BP1355',
  'bosch-quietcast-front-brake-pads-camry-2012-2017',
  'Bosch QuietCast Front Brake Pad Set — Toyota Camry 2012–2017',
  'Premium QuietCast ceramic brake pads with advanced shim technology for whisper-quiet braking and reduced brake dust.',
  'a2000000-0000-0000-0000-000000000011',
  'Bosch', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/a9WQ17QfipfcDmnwqXSh3PcXcOuAv260MGeGL7HM.webp"]'::jsonb,
  '{"position":"Front","compound":"Ceramic","fitment":"Toyota Camry 2012-2017","origin":"Germany"}'::jsonb,
  '[{"title":"Quiet operation","text":"Multi-layer shim design reduces brake squeal and vibration."},{"title":"Low dust","text":"Ceramic formula cuts down wheel face dust compared to semi-metallic pads."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000022',
  'AF-AKEBONO-ACT1634',
  'akebono-proact-front-brake-pads-honda-accord',
  'Akebono ProACT Ultra-Premium Front Brake Pads — Honda Accord',
  'Ultra-premium ceramic brake pads engineered for superior fade resistance and silent stopping on Honda Accord.',
  'a2000000-0000-0000-0000-000000000011',
  'Akebono', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/Vq5tbYDolM5eBjtfRam1Z22Z457jPpEnoIQlIgor.png"]'::jsonb,
  '{"part_number":"ACT1634","position":"Front","compound":"Ultra-premium ceramic","fitment":"Honda Accord"}'::jsonb,
  '[{"title":"Fade resistant","text":"Maintains braking feel during hard or repeated stops."},{"title":"Ceramic formula","text":"Reduced dust and quieter brake pedal feel than standard pads."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000023',
  'AF-TOY-047780E010',
  'toyota-oem-front-brake-pad-set-047780e010-camry',
  'Toyota OEM Front Brake Pad Set (047780E010) — Camry 2006–2011',
  'Original Toyota front brake pad set for confident daily braking and precise factory feel on Camry.',
  'a2000000-0000-0000-0000-000000000011',
  'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/a9WQ17QfipfcDmnwqXSh3PcXcOuAv260MGeGL7HM.webp"]'::jsonb,
  '{"part_number":"047780E010","position":"Front","compound":"OEM ceramic","fitment":"Toyota Camry 2006-2011"}'::jsonb,
  '[{"title":"OEM stopping power","text":"Preserves Toyota braking balance from the factory."},{"title":"Dust-seal design","text":"Helps keep wheels and calipers clean during daily use."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000024',
  'AF-BREMBO-P83113',
  'brembo-oe-replacement-brake-pads-lexus-es350',
  'Brembo OE Replacement Front Brake Pads — Lexus ES350',
  'Brembo OE replacement pads tuned for the ES350 chassis — strong initial bite and consistent fade resistance.',
  'a2000000-0000-0000-0000-000000000011',
  'Brembo', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/czrShvbvzOpThyBV8K8kRlY6jPgPS6nXMLJNtBCn.png"]'::jsonb,
  '{"part_number":"P83113","position":"Front","fitment":"Lexus ES350","compound":"NAO ceramic"}'::jsonb,
  '[{"title":"Brembo performance","text":"Race-derived compound tuned for smooth road and light track use."},{"title":"OE fitment","text":"Drop-in replacement requiring no bracket modifications."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000025',
  'AF-TOY-WB-CAMRY',
  'toyota-camry-front-wheel-bearing-hub-assembly',
  'Toyota Camry Front Wheel Bearing Hub Assembly (2007–2011)',
  'Direct-fit front hub bearing assembly for Toyota Camry with integrated ABS sensor ring for smooth ABS operation.',
  'a2000000-0000-0000-0000-000000000011',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/yi80Ugih9wZX4t4xrjpwb75Yhkq7lq4LJTWycKFO.jpg"]'::jsonb,
  '{"position":"Front","quantity":"Single","abs_ring":"Integrated","fitment":"Toyota Camry 2007-2011"}'::jsonb,
  '[{"title":"Plug-and-play hub","text":"Pre-assembled unit cuts installation time and effort."},{"title":"ABS compatible","text":"Integrated tone ring keeps ABS electronics working correctly."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000026',
  'AF-ROTOR-FRONT-PAIR',
  'coated-front-brake-disc-rotor-pair-toyota-camry',
  'Coated Front Brake Disc / Rotor Pair — Toyota Camry 2012–2017',
  'Zinc-coated front rotors for reduced rust bloom, cleaner install, and stable pedal feel matched to OE specs.',
  'a2000000-0000-0000-0000-000000000011',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/9K2Jl53jNafs2ENEcRQV4AJPQnqaPdGYOMqI5KIZ.png"]'::jsonb,
  '{"position":"Front","finish":"Zinc coated","quantity":"Pair","fitment":"Toyota Camry 2012-2017"}'::jsonb,
  '[{"title":"Anti-rust coating","text":"Zinc layer slows surface corrosion during storage and early bedding."},{"title":"OE dimensions","text":"Matched to factory rotor diameter and vane configuration."}]'::jsonb,
  false
),

-- ===================== SUSPENSION PARTS =====================

(
  'b2000000-0000-0000-0000-000000000027',
  'AF-MONROE-MA822',
  'monroe-reflex-front-shock-absorbers-toyota-camry-pair',
  'Monroe Reflex Front Shock Absorbers — Toyota Camry 2007–2011 Pair',
  'Gas-charged front shock absorbers for a controlled, responsive ride that fights nose dive and body roll.',
  'a2000000-0000-0000-0000-000000000012',
  'Monroe', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/GZlGBA4N3zcxWQ3kwwlJebzQgkbiUOyRODo0FUoD.jpg"]'::jsonb,
  '{"part_number":"MA822","position":"Front","type":"Gas-charged","quantity":"Pair","fitment":"Toyota Camry 2007-2011"}'::jsonb,
  '[{"title":"Gas-charged response","text":"Consistent damping under varying road conditions."},{"title":"Dive and roll control","text":"Reduces front-end dive under hard braking."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000028',
  'AF-KYB-SR4114',
  'kyb-excel-g-rear-shock-absorbers-toyota-camry-pair',
  'KYB Excel-G Rear Shock Absorbers — Toyota Camry 2012–2017 Pair',
  'KYB Excel-G rear shocks matched to factory valving for smooth daily comfort and stable rear-end control.',
  'a2000000-0000-0000-0000-000000000012',
  'KYB', 'new', 'oes',
  '["https://autofactorng.com/images/products/l/GZlGBA4N3zcxWQ3kwwlJebzQgkbiUOyRODo0FUoD.jpg"]'::jsonb,
  '{"part_number":"SR4114","position":"Rear","type":"Gas-charged","quantity":"Pair","fitment":"Toyota Camry 2012-2017"}'::jsonb,
  '[{"title":"OES-matched valving","text":"Calibrated to restore original ride quality, not sporty or stiff."},{"title":"Rear axle pair","text":"Both rear units shipped together for balanced replacement."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000029',
  'AF-BJ-CAMRY-FRONT',
  'toyota-camry-front-lower-ball-joint-pair-2007-2011',
  'Toyota Camry Front Lower Ball Joint Pair (2007–2011)',
  'Front lower ball joints with dust seals for Toyota Camry — restores correct caster, steering feel, and ride height.',
  'a2000000-0000-0000-0000-000000000012',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/YHv5AmGHYaqYObQc53LHUvaxPMbgXef5OnY0yAJV.png"]'::jsonb,
  '{"position":"Front lower","quantity":"Pair","fitment":"Toyota Camry 2007-2011","seals":"Integrated dust seals"}'::jsonb,
  '[{"title":"Steering accuracy","text":"Worn ball joints cause wandering and tyre edge wear — this fixes it."},{"title":"Sealed joint","text":"Factory-style dust boots protect the grease inside from road contamination."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000030',
  'AF-TIEROD-ACCORD',
  'honda-accord-outer-tie-rod-end-pair-2008-2012',
  'Honda Accord Outer Tie Rod End Pair (2008–2012)',
  'Outer tie rod end pair for Honda Accord with boot seals — fixes steering looseness and alignment wander.',
  'a2000000-0000-0000-0000-000000000012',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/rny2Jl9prw2eDNvLeNK2B4ITFkIQ9zw4zRmaCJ4M.jpg"]'::jsonb,
  '{"position":"Outer","quantity":"Pair","fitment":"Honda Accord 2008-2012","seals":"Boot included"}'::jsonb,
  '[{"title":"Steering tightness","text":"Replaces worn joints causing play in the steering wheel."},{"title":"Pair for balance","text":"Both outer ends included for even steering geometry correction."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000031',
  'AF-SWAYBAR-TOY-FRONT',
  'toyota-front-sway-bar-stabilizer-end-link-set',
  'Toyota Front Sway Bar / Stabilizer End Link Set (2010–2018)',
  'Front sway bar end links for Toyota — reduces body roll, clunking, and unpredictable corner behaviour.',
  'a2000000-0000-0000-0000-000000000012',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/N90xXnVumAbbTt4gS13rrb1acNnllNwqYtgpXiOT.jpg"]'::jsonb,
  '{"position":"Front","quantity":"Pair","fitment":"Toyota Camry, Corolla, Avalon 2010-2018"}'::jsonb,
  '[{"title":"Body roll control","text":"Worn links let the sway bar float and clunk — these fix it."},{"title":"Broad Toyota fit","text":"Suits Camry, Corolla, and Avalon platforms of the same generation."}]'::jsonb,
  false
),

-- ===================== ENGINE PARTS =====================

(
  'b2000000-0000-0000-0000-000000000032',
  'AF-TCHK-2ARFE',
  'toyota-camry-2ar-fe-timing-chain-kit-2012-2017',
  'Toyota Camry 2AR-FE Engine Timing Chain Kit (2012–2017)',
  'Full timing chain kit for the 2AR-FE engine — includes chain, guides, tensioner, and seals for a complete service.',
  'a2000000-0000-0000-0000-000000000013',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"2AR-FE 2.5L","fitment":"Toyota Camry 2012-2017","contents":"Chain, guides, tensioner, seals"}'::jsonb,
  '[{"title":"Complete kit","text":"All chain-drive components in one box — chain, guides, tensioner, and seals."},{"title":"Rattling prevention","text":"Worn timing chain causes cold-start rattle — replacing it protects the engine."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000033',
  'AF-VCG-ACCORD-K24',
  'honda-accord-k24-valve-cover-gasket-set',
  'Honda Accord K24A2 Valve Cover Gasket & Spark Plug Tube Seal Set',
  'Valve cover gasket set for Honda Accord K24 engines — includes all seals needed to stop oil seepage at the top end.',
  'a2000000-0000-0000-0000-000000000013',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"K24A2","fitment":"Honda Accord 2003-2007","contents":"Gasket, spark plug tube seals, bolts"}'::jsonb,
  '[{"title":"Leak-free top end","text":"Seals the valve cover to stop oil from dripping onto the exhaust."},{"title":"Complete seal set","text":"Includes plug tube seals and all perimeter gaskets."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000034',
  'AF-HGS-1MZF3',
  'toyota-lexus-1mz-fe-head-gasket-set-2007-2011',
  'Toyota / Lexus 1MZ-FE Head Gasket Set (2007–2011)',
  'Full head gasket set for 1MZ-FE V6 engines used in Camry, ES300, and Sienna — includes all upper-engine gaskets.',
  'a2000000-0000-0000-0000-000000000013',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"1MZ-FE 3.0L V6","fitment":"Toyota Camry, Lexus ES300, Toyota Sienna 1997-2003","contents":"Head gasket, intake/exhaust manifold gaskets, valve seals"}'::jsonb,
  '[{"title":"V6 top-end rebuild","text":"Full set for a thorough head gasket job or engine overhaul."},{"title":"Multiple applications","text":"Fits several 1MZ-FE applications including Sienna and ES300."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000035',
  'AF-TBKIT-HYUNDAI-G4KC',
  'hyundai-sonata-g4kc-timing-belt-kit-2006-2010',
  'Hyundai Sonata G4KC 2.4L Timing Belt Kit (2006–2010)',
  'Complete timing belt kit for the Hyundai G4KC engine — belt, tensioner, idler, and water pump for a full service.',
  'a2000000-0000-0000-0000-000000000013',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"G4KC 2.4L","fitment":"Hyundai Sonata 2006-2010","contents":"Belt, tensioner, idler pulley, water pump"}'::jsonb,
  '[{"title":"Belt-plus-pump service","text":"Replace the belt and water pump together to avoid reopening the job early."},{"title":"Full tension kit","text":"Includes tensioner and idler so you do not need to source parts separately."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000036',
  'AF-OPG-TOY-2AZ',
  'toyota-rav4-2az-fe-oil-pan-gasket',
  'Toyota RAV4 / Camry 2AZ-FE Oil Pan Gasket',
  'Oil pan gasket for 2AZ-FE engines — stops oil pan leaks caused by a cracked or degraded factory gasket.',
  'a2000000-0000-0000-0000-000000000013',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"2AZ-FE 2.4L","fitment":"Toyota Camry 2002-2006, Toyota RAV4 2001-2005","material":"Rubber-coated steel"}'::jsonb,
  '[{"title":"Stop oil pan leaks","text":"Fixes low-oil warnings caused by worn or cracked bottom gaskets."},{"title":"Steel-backed seal","text":"More durable than paper gaskets — resists heat and vibration."}]'::jsonb,
  false
),

-- ===================== STEERING PARTS =====================

(
  'b2000000-0000-0000-0000-000000000037',
  'AF-TRE-TOY-CAMRY-F',
  'toyota-camry-front-inner-tie-rod-end-pair-2012-2017',
  'Toyota Camry Front Inner Tie Rod End Pair (2012–2017)',
  'Inner tie rod ends with articulation boot for Toyota Camry — restores precision steering and eliminates column knock.',
  'a2000000-0000-0000-0000-000000000014',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/YHv5AmGHYaqYObQc53LHUvaxPMbgXef5OnY0yAJV.png"]'::jsonb,
  '{"position":"Front inner","quantity":"Pair","fitment":"Toyota Camry 2012-2017","includes":"Boot seals"}'::jsonb,
  '[{"title":"Steering precision","text":"Inner tie rod wear shows as shaking and wander — replacing restores control."},{"title":"Sealed articulation","text":"Boot-sealed joints resist road grime and moisture."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000038',
  'AF-PSP-CAMRY-3GRFE',
  'toyota-camry-power-steering-pump-3gr-fe-2006-2011',
  'Toyota Camry Power Steering Pump — 3GR-FE V6 (2006–2011)',
  'Remanufactured power steering pump for Camry V6 — restores full assisted steering with no leaks and quiet operation.',
  'a2000000-0000-0000-0000-000000000014',
  'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"engine":"3GR-FE V6","fitment":"Toyota Camry V6 2006-2011","condition_detail":"Professionally remanufactured, tested"}'::jsonb,
  '[{"title":"Restored assist","text":"Heavy or unresponsive steering wheel is a clear sign the pump is failing."},{"title":"Remanufactured to spec","text":"Cleaned, rebuilt, and tested to OEM pressure and flow ratings."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000039',
  'AF-SBOOT-COROLLA',
  'toyota-corolla-steering-rack-boot-kit-2003-2008',
  'Toyota Corolla Steering Rack Boot Kit (2003–2008)',
  'Steering rack boot and clamp kit — protects rack-and-pinion internals from dust and water after boot tear.',
  'a2000000-0000-0000-0000-000000000014',
  'Generic Genuine', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"fitment":"Toyota Corolla 2003-2008","contents":"2 boots, 4 clamps","material":"EPDM rubber"}'::jsonb,
  '[{"title":"Rack protection","text":"A torn boot exposes the inner rack to water and grit — replace before damage sets in."},{"title":"Full kit","text":"Both boots and all clamps in one package for a clean job."}]'::jsonb,
  false
),

-- ===================== EXHAUST SYSTEM =====================

(
  'b2000000-0000-0000-0000-000000000040',
  'AF-CATBACK-CAMRY',
  'walker-exhaust-muffler-toyota-camry-2007-2011',
  'Walker Quiet-Flow Muffler — Toyota Camry 2007–2011',
  'Direct-fit stainless-steel muffler for Camry — no cutting, no welding, and quiet operation from day one.',
  'a2000000-0000-0000-0000-000000000015',
  'Walker', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Toyota Camry 2007-2011","material":"Aluminised steel","install":"Bolt-on direct fit"}'::jsonb,
  '[{"title":"Bolt-on fit","text":"No modification needed — slides onto factory flanges and clamps."},{"title":"Quiet-flow design","text":"Perforated core with absorption packing reduces drone."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000041',
  'AF-EXH-FLEX-ACCORD',
  'honda-accord-exhaust-flex-pipe-2008-2012',
  'Honda Accord Exhaust Flex Pipe Section (2008–2012)',
  'Replacement flex section for Honda Accord exhaust — fixes cracks and rattles caused by heat cycling and road vibration.',
  'a2000000-0000-0000-0000-000000000015',
  'Generic Genuine', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Honda Accord 2008-2012","material":"Stainless mesh flex","length":"18 inches"}'::jsonb,
  '[{"title":"Stop exhaust rattles","text":"Cracked flex pipes cause loud rattling and fumes — quick bolt-on fix."},{"title":"Stainless mesh","text":"Flexible design absorbs engine movement without cracking."}]'::jsonb,
  false
),

-- ===================== AIR FILTER =====================

(
  'b2000000-0000-0000-0000-000000000042',
  'AF-KN-33-2171',
  'kn-high-flow-air-filter-toyota-camry-33-2171',
  'K&N High-Flow Drop-In Air Filter — Toyota Camry (33-2171)',
  'Washable, reusable high-flow air filter for Toyota Camry — improves airflow and engine breathing for better response.',
  'a2000000-0000-0000-0000-000000000022',
  'K&N', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"33-2171","fitment":"Toyota Camry","type":"Drop-in replacement","washable":"Yes, lifetime filter"}'::jsonb,
  '[{"title":"Lifetime filter","text":"Wash and re-oil instead of buying new every 15,000 km."},{"title":"Better airflow","text":"Cotton-gauze media flows more air than paper — sharper throttle response."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000043',
  'AF-MANN-C25004',
  'mann-filter-air-filter-c25004-honda-accord',
  'MANN-FILTER Air Filter C 25 004 — Honda Accord / CR-V',
  'German-made paper air filter for Honda Accord and CR-V — OEM-quality filtration to protect engine from dust and debris.',
  'a2000000-0000-0000-0000-000000000022',
  'MANN', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"part_number":"C 25 004","fitment":"Honda Accord 2003-2012, Honda CR-V 2002-2011","media":"Multi-layer paper","origin":"Germany"}'::jsonb,
  '[{"title":"German engineering","text":"MANN-FILTER paper media is widely used as OEM supply for many European and Asian brands."},{"title":"Multi-car fit","text":"Suits Accord sedan and CR-V wagons of the same generation."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000044',
  'AF-TOY-AF-CAMRY-2012',
  'toyota-oem-engine-air-filter-camry-2012-2017',
  'Toyota OEM Engine Air Filter — Camry 2.5L 2AR-FE (2012–2017)',
  'Direct Toyota replacement air filter for Camry 2.5L. Flat panel element for easy service intervals.',
  'a2000000-0000-0000-0000-000000000022',
  'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"engine":"2AR-FE 2.5L","fitment":"Toyota Camry 2012-2017","service_interval":"Every 40,000 km or annually"}'::jsonb,
  '[{"title":"OEM protection","text":"Same spec as the factory-installed filter — no risk of warranty issues."},{"title":"Easy swap","text":"Panel filter sits in an accessible airbox with no tools required."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000045',
  'AF-MANN-CAF1827',
  'mann-cabin-air-filter-hyundai-kia-cu2842',
  'MANN Cabin Air Filter CU 2842 — Hyundai / KIA (2004–2010)',
  'Carbon-activated cabin air filter for Hyundai and KIA — removes pollen, dust, and odours from passenger air.',
  'a2000000-0000-0000-0000-000000000022',
  'MANN', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp"]'::jsonb,
  '{"part_number":"CU 2842","type":"Carbon-activated","fitment":"Hyundai Sonata, Tucson, KIA Sportage 2004-2010"}'::jsonb,
  '[{"title":"Carbon activated","text":"Reduces bad smells and traffic-exhaust fumes entering the cabin."},{"title":"Hyundai/KIA fitment","text":"Covers Sonata, Elantra, Tucson, and Sportage of the same era."}]'::jsonb,
  false
),

-- ===================== SPARK PLUGS =====================

(
  'b2000000-0000-0000-0000-000000000046',
  'AF-NGK-ILZKR7B-11',
  'ngk-iridium-ix-spark-plugs-set-4-toyota-camry',
  'NGK Iridium IX Spark Plugs — Set of 4 (Toyota Camry 2012–2017)',
  'Fine-wire iridium centre electrode spark plugs for Toyota Camry — improved ignitability, fuel economy, and engine response.',
  'a2000000-0000-0000-0000-000000000023',
  'NGK', 'new', 'oem',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"ILZKR7B-11","quantity":"Set of 4","fitment":"Toyota Camry 2.5L 2AR-FE 2012-2017","electrode":"Iridium","gap":"1.1mm"}'::jsonb,
  '[{"title":"Iridium ignitability","text":"Finer electrode needs less voltage — quicker, more consistent spark."},{"title":"Long service life","text":"Iridium plugs last up to 100,000 km before replacement."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000047',
  'AF-BOSCH-9652',
  'bosch-double-iridium-spark-plugs-set-4-honda-accord',
  'Bosch Double Iridium Spark Plugs — Set of 4 (Honda Accord 2003–2007)',
  'Double iridium plugs with 0.6mm electrode tip for faster throttle response and up to 4× longer life than copper plugs.',
  'a2000000-0000-0000-0000-000000000023',
  'Bosch', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"9652","quantity":"Set of 4","fitment":"Honda Accord 2.4L K24A2 2003-2007","electrode":"Double iridium","gap":"1.0mm"}'::jsonb,
  '[{"title":"Double iridium","text":"Both centre and ground electrodes are tipped — longer life and better spark."},{"title":"Cold-start improvement","text":"Helps engines that hesitate or misfire on cold morning starts."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000048',
  'AF-DENSO-IXU22',
  'denso-iridium-power-spark-plugs-set-4-toyota-corolla',
  'Denso Iridium Power Spark Plugs — Set of 4 (Toyota Corolla)',
  'Japanese Denso iridium plugs with a fine 1.1mm tip for cleaner combustion and noticeable mid-range power improvement.',
  'a2000000-0000-0000-0000-000000000023',
  'Denso', 'new', 'oem',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"IXU22","quantity":"Set of 4","fitment":"Toyota Corolla 1.8L 2003-2008","electrode":"Iridium","gap":"1.1mm","origin":"Japan"}'::jsonb,
  '[{"title":"Denso OEM quality","text":"Denso supplies plugs to Toyota as factory-fitted equipment."},{"title":"Combustion efficiency","text":"Fine tip improves burn pattern and reduces unburnt fuel."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000049',
  'AF-CHAMPION-9801',
  'champion-platinum-spark-plugs-set-4-hyundai-elantra',
  'Champion Platinum Spark Plugs — Set of 4 (Hyundai Elantra / Kia)',
  'Platinum-tipped spark plugs for Hyundai and KIA 4-cylinder engines — reliable service with longer change intervals.',
  'a2000000-0000-0000-0000-000000000023',
  'Champion', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"quantity":"Set of 4","fitment":"Hyundai Elantra, KIA Cerato 1.6L / 2.0L","electrode":"Platinum","gap":"1.0mm"}'::jsonb,
  '[{"title":"Platinum durability","text":"Platinum tip holds its edge longer than standard nickel plugs."},{"title":"Wide Hyundai/KIA fit","text":"Compatible with 1.6L and 2.0L 4-cylinder engines in both brands."}]'::jsonb,
  false
),

-- ===================== FUEL FILTER =====================

(
  'b2000000-0000-0000-0000-000000000050',
  'AF-FF-TOY-23300-74330',
  'toyota-genuine-fuel-filter-23300-74330-camry',
  'Toyota Genuine Inline Fuel Filter 23300-74330 — Camry / Corolla',
  'OEM Toyota fuel filter for Camry and Corolla with external canister design — replaces at every 80,000 km service.',
  'a2000000-0000-0000-0000-000000000024',
  'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"23300-74330","fitment":"Toyota Camry, Corolla (multiple years)","type":"Inline canister"}'::jsonb,
  '[{"title":"Clean fuel flow","text":"Traps rust, sediment, and gum before they reach injectors and the pump."},{"title":"OEM replacement","text":"Toyota genuine part — correct fitment, no adapter needed."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000051',
  'AF-BOSCH-FF-N2064',
  'bosch-n2064-fuel-filter-honda-accord',
  'Bosch N2064 Fuel Filter — Honda Accord 2.4L (2003–2007)',
  'High-capacity Bosch fuel filter with two-stage paper element for Honda Accord — stops varnish and particulates.',
  'a2000000-0000-0000-0000-000000000024',
  'Bosch', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"]'::jsonb,
  '{"part_number":"N2064","fitment":"Honda Accord 2.4L 2003-2007","media":"Two-stage paper"}'::jsonb,
  '[{"title":"Two-stage filtration","text":"Outer coarse layer + inner fine paper for thorough particulate removal."},{"title":"Direct Accord fit","text":"Calibrated for factory fuel line pressure on the K24 engine."}]'::jsonb,
  false
),

-- ===================== TIMING BELTS =====================

(
  'b2000000-0000-0000-0000-000000000052',
  'AF-GATES-TCK170',
  'gates-timing-belt-kit-honda-accord-f23a',
  'Gates PowerGrip Timing Belt Kit — Honda Accord F23A 2.3L (1998–2002)',
  'Complete Gates timing belt kit for Honda Accord F23A — includes belt, tensioner, idler, and water pump for one-stop service.',
  'a2000000-0000-0000-0000-000000000025',
  'Gates', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"TCK170","engine":"F23A 2.3L","fitment":"Honda Accord 1998-2002","contents":"Belt, tensioner, idler, water pump"}'::jsonb,
  '[{"title":"Complete kit","text":"All four components in one Gates box — avoids sourcing parts from multiple suppliers."},{"title":"PowerGrip belt","text":"Proven Gates belt material rated for high heat and oil-mist exposure."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000053',
  'AF-DAYCO-95333K1',
  'dayco-timing-belt-kit-toyota-camry-5sfe',
  'Dayco Timing Belt Kit — Toyota Camry 5S-FE 2.2L (1992–2001)',
  'Dayco timing belt and tensioner kit for older Camry 5S-FE engines — keeps older cars running reliably.',
  'a2000000-0000-0000-0000-000000000025',
  'Dayco', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"engine":"5S-FE 2.2L","fitment":"Toyota Camry 1992-2001","contents":"Belt, tensioner spring, tensioner bolt"}'::jsonb,
  '[{"title":"Legacy engine support","text":"Dayco stocks belts for high-mileage and older-gen Toyota engines."},{"title":"Service timing","text":"5S-FE belt is due every 90,000 km — skipping risks a snapped belt and bent valves."}]'::jsonb,
  false
),

-- ===================== GEAR OIL & ATF =====================

(
  'b2000000-0000-0000-0000-000000000054',
  'AF-TOY-ATF-WS-4L',
  'toyota-atf-ws-automatic-transmission-fluid-4-litres',
  'Toyota ATF WS Automatic Transmission Fluid — 4 Litres',
  'Toyota World Standard (WS) ATF for Toyota/Lexus automatic gearboxes — prevents shudder and slipping in service intervals.',
  'a2000000-0000-0000-0000-000000000032',
  'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/j5RTR0vGQ1AiPcmZB2ctAGQIZXY5wNt0nZAvqGVo.png"]'::jsonb,
  '{"specification":"ATF-WS","volume":"4 litres","fitment":"Toyota/Lexus automatic transmissions 2005+","colour":"Red"}'::jsonb,
  '[{"title":"WS specification","text":"Required for modern Toyota autos — using wrong ATF causes shudder and solenoid damage."},{"title":"Anti-shudder formula","text":"Keeps clutch packs engaging smoothly over thousands of kilometres."}]'::jsonb,
  true
),
(
  'b2000000-0000-0000-0000-000000000055',
  'AF-SHELL-SPIRAX-ATF-1L',
  'shell-spirax-s4-atf-full-synthetic-transmission-fluid-1l',
  'Shell Spirax S4 ATF Full Synthetic Transmission Fluid — 1 Litre',
  'High-performance full-synthetic ATF for multi-make automatic gearboxes — suitable as a Toyota Dexron III/IV top-up.',
  'a2000000-0000-0000-0000-000000000032',
  'Shell', 'new', 'oem',
  '["https://autofactorng.com/images/products/l/7tAnQviz9VjOgUIxRaRUWJUVFSWKmfnmbYoglmZm.png"]'::jsonb,
  '{"specification":"Dexron VI / Mercon LV compatible","volume":"1 litre","type":"Full synthetic"}'::jsonb,
  '[{"title":"Multi-vehicle spec","text":"Covers Dexron VI, Mercon LV, and Toyota Dexron III — wide fitment range."},{"title":"Full synthetic base","text":"Maintains viscosity stability in high heat and frequent gear changes."}]'::jsonb,
  true
),
(
  'b2000000-0000-0000-0000-000000000056',
  'AF-CASTROL-TRANSMAX-1L',
  'castrol-transmax-atf-dex-iii-multivehicle-1-litre',
  'Castrol Transmax ATF Dex/Merc Multivehicle — 1 Litre',
  'Castrol Dex/Merc ATF for older automatic transmissions across Toyota, Honda, Ford, and GM platforms.',
  'a2000000-0000-0000-0000-000000000032',
  'Castrol', 'new', 'aftermarket',
  '["https://autofactorng.com/images/products/l/Dfvf4kHQl4JVSvOUQgYN0px5R9din8y9l40DZ1Ja.webp"]'::jsonb,
  '{"specification":"Dexron III / Mercon","volume":"1 litre","fitment":"Most pre-2005 Toyota, Honda, Ford automatics"}'::jsonb,
  '[{"title":"Broad compatibility","text":"Dexron III/Mercon covers a very wide range of older automatic gearboxes."},{"title":"Castrol quality","text":"Trusted brand for routine ATF top-ups and drain-fill services."}]'::jsonb,
  true
),

-- ===================== BRAKE FLUID & COOLANT =====================

(
  'b2000000-0000-0000-0000-000000000057',
  'AF-ATE-DOT4-500ML',
  'ate-typ-200-dot-4-brake-fluid-500ml',
  'ATE TYP 200 DOT 4 Brake Fluid — 500 ml',
  'Premium DOT 4 brake fluid with high wet boiling point — resists vapour lock and fade under hard braking conditions.',
  'a2000000-0000-0000-0000-000000000033',
  'ATE', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/XVyuLyp1izSHnlblXXdvplQkVbexPRmELSr90X6L.jpg"]'::jsonb,
  '{"specification":"DOT 4","volume":"500 ml","dry_boiling_point":"265°C","wet_boiling_point":"165°C","origin":"Germany"}'::jsonb,
  '[{"title":"High boiling point","text":"265°C dry boiling point prevents vapour lock and brake fade under hard use."},{"title":"Compatible with DOT 3 / 4","text":"Safe for use in all DOT 3 and DOT 4 systems."}]'::jsonb,
  true
),
(
  'b2000000-0000-0000-0000-000000000058',
  'AF-PRESTONE-COOLANT-3.78L',
  'prestone-50-50-coolant-antifreeze-3-78-litres',
  'Prestone 50/50 Coolant & Antifreeze — 3.78 Litres (All Vehicles)',
  'Ready-to-use 50/50 premix coolant for all vehicle types — prevents freeze, overheating, and corrosion in the cooling system.',
  'a2000000-0000-0000-0000-000000000033',
  'Prestone', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/XVyuLyp1izSHnlblXXdvplQkVbexPRmELSr90X6L.jpg"]'::jsonb,
  '{"type":"50/50 premix","volume":"3.78 litres (1 gallon)","colour":"Green","compatibility":"All vehicles"}'::jsonb,
  '[{"title":"Ready to pour","text":"Pre-diluted 50/50 mix — no measuring or mixing needed."},{"title":"Corrosion inhibitors","text":"Protects aluminium, steel, and cast-iron cooling-system components."}]'::jsonb,
  true
),
(
  'b2000000-0000-0000-0000-000000000059',
  'AF-TOY-SLLC-2L',
  'toyota-super-long-life-coolant-pink-2-litres',
  'Toyota Super Long Life Coolant (Pink) — 2 Litres Concentrate',
  'Toyota SLLC concentrate for Toyota and Lexus vehicles — mix 1:1 with distilled water for full 5-year protection.',
  'a2000000-0000-0000-0000-000000000033',
  'Toyota', 'new', 'oem',
  '["https://autofactorng.com/images/category/XVyuLyp1izSHnlblXXdvplQkVbexPRmELSr90X6L.jpg"]'::jsonb,
  '{"type":"Concentrate","volume":"2 litres","colour":"Pink / Red","mix_ratio":"1:1 with distilled water","service_life":"5 years or 160,000 km"}'::jsonb,
  '[{"title":"Toyota OEM spec","text":"Required fluid for Camry, RAV4, Corolla, and Lexus models — wrong coolant shortens water pump life."},{"title":"5-year protection","text":"Long-life OAT formula lasts twice as long as conventional coolant."}]'::jsonb,
  true
),

-- ===================== CAR BATTERIES =====================

(
  'b2000000-0000-0000-0000-000000000060',
  'AF-BOSCH-S4008',
  'bosch-s4-008-car-battery-74ah-680cca',
  'Bosch S4 008 Car Battery — 74Ah 680CCA',
  'Maintenance-free Bosch S4 battery for medium and large saloons — strong cold-cranking amps for reliable starts in all conditions.',
  'a2000000-0000-0000-0000-000000000051',
  'Bosch', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"part_number":"S4008","capacity":"74Ah","cca":"680A","voltage":"12V","terminal":"Standard post","fitment":"Toyota Camry, Honda Accord, Lexus ES350, Ford Explorer"}'::jsonb,
  '[{"title":"680 cold-cranking amps","text":"Starts heavy engines reliably even after sitting overnight."},{"title":"Maintenance-free","text":"Sealed AGM design needs no water top-up."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000061',
  'AF-EXIDE-EC700',
  'exide-excell-ec700-70ah-car-battery',
  'Exide Excell EC700 Car Battery — 70Ah 640CCA',
  'Exide Excell lead-acid battery for mid-size and large vehicles — sealed, spill-proof, and ready to install.',
  'a2000000-0000-0000-0000-000000000051',
  'Exide', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"part_number":"EC700","capacity":"70Ah","cca":"640A","voltage":"12V","terminal":"Standard post"}'::jsonb,
  '[{"title":"Ready to install","text":"Factory-charged and sealed — fits directly into the battery tray."},{"title":"Broad fitment","text":"Suits most mid-size sedans, SUVs, and light trucks."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000062',
  'AF-AMARON-45D23L',
  'amaron-hi-life-battery-45d23l-65ah-toyota-honda',
  'Amaron Hi-Life 45D23L Car Battery — 65Ah (Toyota / Honda)',
  'Indian-made Amaron Hi-Life battery built for tropical conditions — handles heat, vibration, and deep discharge cycles well.',
  'a2000000-0000-0000-0000-000000000051',
  'Amaron', 'new', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"part_number":"45D23L","capacity":"65Ah","voltage":"12V","terminal":"JIS","fitment":"Toyota Camry, Corolla, Honda Accord, Civic"}'::jsonb,
  '[{"title":"Tropical design","text":"Amaron builds for hot climates where conventional batteries fail early."},{"title":"Hi-Life chemistry","text":"Enhanced plate design resists deep discharge and rapid recharge cycles."}]'::jsonb,
  false
),

-- ===================== BULBS & LIGHTING =====================

(
  'b2000000-0000-0000-0000-000000000063',
  'AF-OSRAM-64193NBP',
  'osram-night-breaker-laser-h4-headlight-bulbs-twin-pack',
  'OSRAM Night Breaker Laser H4 Headlight Bulbs — Twin Pack',
  'OSRAM Night Breaker Laser H4 bulbs providing up to 150% more light than standard halogens for safer night driving.',
  'a2000000-0000-0000-0000-000000000052',
  'OSRAM', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"64193NBL-HCB","base":"H4","wattage":"60/55W","voltage":"12V","quantity":"Twin pack (2 bulbs)","certification":"ECE approved"}'::jsonb,
  '[{"title":"150% more light","text":"Significantly brighter beam compared to standard halogen bulbs."},{"title":"Twin pack","text":"Replace both headlights at the same time for consistent output."}]'::jsonb,
  true
),
(
  'b2000000-0000-0000-0000-000000000064',
  'AF-PHILIPS-12972CVB2',
  'philips-crystal-vision-ultra-h7-headlight-bulbs-twin-pack',
  'Philips Crystal Vision Ultra H7 Headlight Bulbs — Twin Pack (4300K)',
  'Philips Crystal Vision white 4300K H7 bulbs — crisp white light that improves sign and road marking visibility.',
  'a2000000-0000-0000-0000-000000000052',
  'Philips', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/Pjk5TMe4zRDvzEFM84lUKpldF4F8DdTAEebC2Ggq.webp"]'::jsonb,
  '{"part_number":"12972CVB2","base":"H7","wattage":"55W","colour_temperature":"4300K","quantity":"Twin pack","certification":"ECE approved"}'::jsonb,
  '[{"title":"4300K white light","text":"Closer to daylight than yellow halogens — better contrast on dark roads."},{"title":"Road-legal","text":"ECE-approved — legal for use on public roads without modification."}]'::jsonb,
  true
),

-- ===================== ALTERNATORS & STARTERS =====================

(
  'b2000000-0000-0000-0000-000000000065',
  'AF-ALT-TOY-CAMRY-2GR',
  'toyota-camry-3-5-v6-remanufactured-alternator-2007-2011',
  'Toyota Camry 3.5L V6 Remanufactured Alternator — 2GR-FE (2007–2011)',
  'Professionally remanufactured alternator for Camry V6 — tested to OEM output specs, direct bolt-in replacement.',
  'a2000000-0000-0000-0000-000000000053',
  'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"2GR-FE 3.5L V6","output":"150A","fitment":"Toyota Camry V6 2007-2011","condition_detail":"Remanufactured, load-tested"}'::jsonb,
  '[{"title":"Load-tested","text":"Output verified at 150A before shipping — not a guess, a guaranteed rebuild."},{"title":"Direct fit","text":"Mounts on existing brackets with no wiring modifications."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000066',
  'AF-START-ACCORD-K24',
  'honda-accord-k24-remanufactured-starter-motor-2003-2007',
  'Honda Accord K24 Remanufactured Starter Motor (2003–2007)',
  'Rebuilt starter motor for Honda Accord K24 — solenoid tested, brushes replaced, and armature resurfaced.',
  'a2000000-0000-0000-0000-000000000053',
  'Generic Genuine', 'tokunbo', 'oem',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"engine":"K24A2 2.4L","fitment":"Honda Accord 2003-2007","condition_detail":"Solenoid tested, brushes replaced"}'::jsonb,
  '[{"title":"No-start fix","text":"Slow cranking or click-no-start is usually the starter solenoid or brushes — this fixes both."},{"title":"Rebuilt to spec","text":"Armature resurfaced and windings inspected before shipping."}]'::jsonb,
  false
),

-- ===================== TYRES =====================

(
  'b2000000-0000-0000-0000-000000000067',
  'AF-BRIDGE-EP150-18565R15',
  'bridgestone-ecopia-ep150-185-65r15-tyre',
  'Bridgestone Ecopia EP150 — 185/65 R15 (Single)',
  'Fuel-efficient touring tyre for compact and mid-size sedans — low rolling resistance and quiet motorway performance.',
  'a2000000-0000-0000-0000-000000000041',
  'Bridgestone', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"185/65 R15","load_rating":"88H","type":"Touring","rolling_resistance":"A-rated","fitment":"Toyota Corolla, Honda Civic, Hyundai Elantra"}'::jsonb,
  '[{"title":"Fuel saver","text":"Lower rolling resistance cuts fuel cost on long highway runs."},{"title":"Quiet ride","text":"Optimised pitch sequence reduces cabin noise at motorway speeds."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000068',
  'AF-MICH-XM2-19565R15',
  'michelin-energy-xm2-195-65r15-tyre',
  'Michelin Energy XM2 — 195/65 R15 (Single)',
  'Premium fuel-efficient tyre designed for Nigerian roads — long tread life, good wet grip, and comfortable highway ride.',
  'a2000000-0000-0000-0000-000000000041',
  'Michelin', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"195/65 R15","load_rating":"91H","type":"Touring / Fuel-efficient","origin":"France","fitment":"Toyota Camry, Honda Accord, Hyundai Sonata"}'::jsonb,
  '[{"title":"Michelin longevity","text":"XM2 compound wears slowly — lower cost-per-km than budget tyres."},{"title":"All-season wet grip","text":"Strong aquaplaning resistance for wet-season Lagos and Abuja roads."}]'::jsonb,
  false
),
(
  'b2000000-0000-0000-0000-000000000069',
  'AF-DUNLOP-SP200E-20560R16',
  'dunlop-sp-sport-200e-205-60r16-tyre',
  'Dunlop SP Sport 200E — 205/60 R16 (Single)',
  'Sporty touring tyre for larger sedans and SUVs — good dry cornering grip with a comfortable ride on rough tarmac.',
  'a2000000-0000-0000-0000-000000000041',
  'Dunlop', 'new', 'oem',
  '["https://autofactorng.com/images/category/CWFeB26VJcugEoNXzQNAeNsrqdVazpF8DubcZaY1.webp"]'::jsonb,
  '{"size":"205/60 R16","load_rating":"92V","type":"Sport touring","fitment":"Toyota Camry (wider fitment), Lexus ES, Honda Accord"}'::jsonb,
  '[{"title":"Sport touring balance","text":"Handles B-road tarmac and expressway cruising equally well."},{"title":"Tread pattern","text":"Asymmetric design optimises wet and dry cornering in one tyre."}]'::jsonb,
  false
),

-- ===================== INTERIOR ACCESSORIES =====================

(
  'b2000000-0000-0000-0000-000000000070',
  'AF-MAT-CAMRY-2012',
  'all-weather-floor-mats-toyota-camry-2012-2017',
  'All-Weather Rubber Floor Mats — Toyota Camry (2012–2017) Set of 4',
  'Heavy-duty rubber floor mats custom-fit for Toyota Camry — traps mud, water, and dust from Nigerian roads.',
  'a2000000-0000-0000-0000-000000000061',
  'Generic', 'new', 'aftermarket',
  '["https://autofactorng.com/images/category/vhZYJ0wKwMtDAgBqFDvhEXaWMif1WtqnF5gsgC1j.jpg"]'::jsonb,
  '{"fitment":"Toyota Camry 2012-2017","material":"Heavy-duty rubber","quantity":"Set of 4 (front and rear)","colour":"Black"}'::jsonb,
  '[{"title":"Custom fit","text":"Contoured channels prevent mats from shifting under the pedals."},{"title":"Easy to clean","text":"Hose down or brush off — no staining on carpet underneath."}]'::jsonb,
  false
)

ON CONFLICT (slug) DO NOTHING;


-- --------------------------------------------------------
-- INVENTORY ROWS
-- --------------------------------------------------------

INSERT INTO public.ladipo_part_inventory (part_id, price_kobo, stock_qty, seller_label) VALUES
  -- Brake & Wheel Hub
  ('b2000000-0000-0000-0000-000000000021',  6500000, 12, 'Motoka'), -- Bosch brake pads Camry
  ('b2000000-0000-0000-0000-000000000022',  8200000,  8, 'Motoka'), -- Akebono Honda Accord
  ('b2000000-0000-0000-0000-000000000023',  7500000, 10, 'Motoka'), -- Toyota OEM front pads Camry
  ('b2000000-0000-0000-0000-000000000024',  9800000,  6, 'Motoka'), -- Brembo Lexus ES350
  ('b2000000-0000-0000-0000-000000000025',  4200000, 14, 'Motoka'), -- Camry wheel bearing
  ('b2000000-0000-0000-0000-000000000026',  5500000, 10, 'Motoka'), -- Coated front rotors pair

  -- Suspension
  ('b2000000-0000-0000-0000-000000000027', 14000000,  6, 'Motoka'), -- Monroe shocks Camry
  ('b2000000-0000-0000-0000-000000000028', 13000000,  8, 'Motoka'), -- KYB rear Camry
  ('b2000000-0000-0000-0000-000000000029',  2200000, 14, 'Motoka'), -- Ball joints Camry
  ('b2000000-0000-0000-0000-000000000030',  3500000, 10, 'Motoka'), -- Tie rods Accord
  ('b2000000-0000-0000-0000-000000000031',  1800000, 16, 'Motoka'), -- Sway bar links Toyota

  -- Engine Parts
  ('b2000000-0000-0000-0000-000000000032', 18500000,  4, 'Motoka'), -- Timing chain kit 2AR-FE
  ('b2000000-0000-0000-0000-000000000033',  3800000,  8, 'Motoka'), -- Valve cover gasket Honda
  ('b2000000-0000-0000-0000-000000000034',  7200000,  6, 'Motoka'), -- Head gasket 1MZ-FE
  ('b2000000-0000-0000-0000-000000000035', 12500000,  4, 'Motoka'), -- Timing belt kit Hyundai
  ('b2000000-0000-0000-0000-000000000036',  1800000, 12, 'Motoka'), -- Oil pan gasket

  -- Steering
  ('b2000000-0000-0000-0000-000000000037',  3200000, 10, 'Motoka'), -- Tie rod ends Camry inner
  ('b2000000-0000-0000-0000-000000000038', 28000000,  3, 'Motoka'), -- PS pump Camry tokunbo
  ('b2000000-0000-0000-0000-000000000039',  1500000, 14, 'Motoka'), -- Steering boot Corolla

  -- Exhaust
  ('b2000000-0000-0000-0000-000000000040',  8500000,  6, 'Motoka'), -- Muffler Camry
  ('b2000000-0000-0000-0000-000000000041',  4200000,  8, 'Motoka'), -- Flex pipe Accord

  -- Air Filter
  ('b2000000-0000-0000-0000-000000000042',  5500000,  8, 'Motoka'), -- K&N air filter Camry
  ('b2000000-0000-0000-0000-000000000043',  1800000, 16, 'Motoka'), -- MANN air filter Accord
  ('b2000000-0000-0000-0000-000000000044',  1500000, 20, 'Motoka'), -- Toyota OEM air filter
  ('b2000000-0000-0000-0000-000000000045',  1200000, 18, 'Motoka'), -- MANN cabin filter KIA

  -- Spark Plugs
  ('b2000000-0000-0000-0000-000000000046',  4800000, 12, 'Motoka'), -- NGK iridium Camry x4
  ('b2000000-0000-0000-0000-000000000047',  5200000, 10, 'Motoka'), -- Bosch double iridium Accord x4
  ('b2000000-0000-0000-0000-000000000048',  4500000, 12, 'Motoka'), -- Denso iridium Corolla x4
  ('b2000000-0000-0000-0000-000000000049',  3200000, 14, 'Motoka'), -- Champion platinum KIA x4

  -- Fuel Filter
  ('b2000000-0000-0000-0000-000000000050',  1800000, 16, 'Motoka'), -- Toyota fuel filter
  ('b2000000-0000-0000-0000-000000000051',  2200000, 12, 'Motoka'), -- Bosch fuel filter Accord

  -- Timing Belts
  ('b2000000-0000-0000-0000-000000000052', 14500000,  4, 'Motoka'), -- Gates kit Honda F23A
  ('b2000000-0000-0000-0000-000000000053',  9800000,  6, 'Motoka'), -- Dayco Camry 5S-FE

  -- Gear Oil & ATF
  ('b2000000-0000-0000-0000-000000000054',  7500000,  8, 'Motoka'), -- Toyota ATF WS 4L
  ('b2000000-0000-0000-0000-000000000055',  2800000, 14, 'Motoka'), -- Shell Spirax S4 1L
  ('b2000000-0000-0000-0000-000000000056',  2200000, 16, 'Motoka'), -- Castrol Transmax 1L

  -- Brake Fluid & Coolant
  ('b2000000-0000-0000-0000-000000000057',  1500000, 18, 'Motoka'), -- ATE DOT 4 500ml
  ('b2000000-0000-0000-0000-000000000058',  3800000, 12, 'Motoka'), -- Prestone coolant 3.78L
  ('b2000000-0000-0000-0000-000000000059',  4500000, 10, 'Motoka'), -- Toyota SLLC coolant 2L

  -- Batteries
  ('b2000000-0000-0000-0000-000000000060', 38000000,  6, 'Motoka'), -- Bosch S4 74Ah
  ('b2000000-0000-0000-0000-000000000061', 32000000,  8, 'Motoka'), -- Exide EC700 70Ah
  ('b2000000-0000-0000-0000-000000000062', 28000000, 10, 'Motoka'), -- Amaron Hi-Life 65Ah

  -- Bulbs
  ('b2000000-0000-0000-0000-000000000063',  2800000, 14, 'Motoka'), -- OSRAM NBL H4 twin
  ('b2000000-0000-0000-0000-000000000064',  3200000, 12, 'Motoka'), -- Philips H7 crystal vision twin

  -- Alternators & Starters
  ('b2000000-0000-0000-0000-000000000065', 55000000,  3, 'Motoka'), -- Toyota alternator reman
  ('b2000000-0000-0000-0000-000000000066', 35000000,  4, 'Motoka'), -- Honda starter reman

  -- Tyres
  ('b2000000-0000-0000-0000-000000000067', 3800000, 20, 'Motoka'), -- Bridgestone EP150 185/65R15
  ('b2000000-0000-0000-0000-000000000068', 5200000, 16, 'Motoka'), -- Michelin XM2 195/65R15
  ('b2000000-0000-0000-0000-000000000069', 5800000, 14, 'Motoka'), -- Dunlop SP200E 205/60R16

  -- Interior Accessories
  ('b2000000-0000-0000-0000-000000000070',  1800000, 20, 'Motoka')  -- Floor mats Camry

ON CONFLICT DO NOTHING;
