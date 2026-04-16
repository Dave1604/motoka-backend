-- ─── 051: Replace placeholder images with real photos ────────────────────
-- Images sourced from Unsplash (unsplash.com/license) and Pexels (pexels.com/license)
-- Both are free for commercial use, no attribution required.

-- ═══ Update existing parts with real images ═══

-- Michelin Primacy 4 tyre
UPDATE public.ladipo_parts
SET images = '[
  "https://images.unsplash.com/photo-1623706897185-32d543db92cf?w=600&h=450&fit=crop",
  "https://images.unsplash.com/photo-1444947295498-07f60c19a4ff?w=600&h=450&fit=crop"
]'::jsonb
WHERE slug = 'michelin-primacy-4-225-55r17';

-- Bridgestone Turanza T005 tyre
UPDATE public.ladipo_parts
SET images = '[
  "https://images.unsplash.com/photo-1584640118745-46bb0ffa05d2?w=600&h=450&fit=crop",
  "https://images.unsplash.com/photo-1527266258038-6ae3e089a609?w=600&h=450&fit=crop"
]'::jsonb
WHERE slug = 'bridgestone-turanza-t005-235-45r18';

-- Hankook Ventus K120 tyre
UPDATE public.ladipo_parts
SET images = '[
  "https://images.unsplash.com/photo-1629086301886-7a59783e50e7?w=600&h=450&fit=crop",
  "https://images.unsplash.com/photo-1623706897185-32d543db92cf?w=600&h=450&fit=crop"
]'::jsonb
WHERE slug = 'hankook-ventus-k120-265-35r20';

-- NGK BKR6E Spark Plug
UPDATE public.ladipo_parts
SET images = '[
  "https://images.pexels.com/photos/36086528/pexels-photo-36086528.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/8651903/pexels-photo-8651903.jpeg?auto=compress&cs=tinysrgb&w=600"
]'::jsonb
WHERE slug = 'ngk-bkr6e-spark-plug';

-- Mann-Filter Oil Filter
UPDATE public.ladipo_parts
SET images = '[
  "https://images.pexels.com/photos/159293/car-engine-motor-clean-customized-159293.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/5158168/pexels-photo-5158168.jpeg?auto=compress&cs=tinysrgb&w=600"
]'::jsonb
WHERE slug = 'mann-oil-filter-w71380';

-- Universal Car Cover
UPDATE public.ladipo_parts
SET images = '[
  "https://images.pexels.com/photos/3354648/pexels-photo-3354648.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/3354647/pexels-photo-3354647.jpeg?auto=compress&cs=tinysrgb&w=600"
]'::jsonb
WHERE slug = 'universal-car-cover-large';


-- ═══ Add more parts with real images ═══

-- New Tyres
INSERT INTO public.ladipo_parts (id, sku, slug, name, description, category_id, brand, condition, part_type, images, specifications, key_features) VALUES
(
  'b1000000-0000-0000-0000-000000000007',
  'TYR-PRL-P7-205',
  'pirelli-cinturato-p7-205-55r16',
  'Pirelli Cinturato P7 — 205/55R16',
  'Eco-friendly performance tyre with low rolling resistance and wet grip.',
  'a1000000-0000-0000-0000-000000000001',
  'Pirelli',
  'new',
  'oem',
  '["https://images.unsplash.com/photo-1629086301886-7a59783e50e7?w=600&h=450&fit=crop", "https://images.unsplash.com/photo-1444947295498-07f60c19a4ff?w=600&h=450&fit=crop"]',
  '{"size": "205/55R16", "load_index": "91V", "speed_rating": "V"}',
  '[{"title": "Eco-performance: ", "text": "Low rolling resistance saves fuel without sacrificing grip."}, {"title": "Wet braking: ", "text": "Optimised tread compound for shorter wet stops."}]'
),
(
  'b1000000-0000-0000-0000-000000000008',
  'TYR-DLP-SP01-245',
  'dunlop-sp-sport-01-245-45r18',
  'Dunlop SP Sport 01 — 245/45R18',
  'High-performance sport tyre designed for agile handling and stability.',
  'a1000000-0000-0000-0000-000000000001',
  'Dunlop',
  'new',
  'aftermarket',
  '["https://images.unsplash.com/photo-1584640118745-46bb0ffa05d2?w=600&h=450&fit=crop", "https://images.unsplash.com/photo-1629086301886-7a59783e50e7?w=600&h=450&fit=crop"]',
  '{"size": "245/45R18", "load_index": "100W", "speed_rating": "W"}',
  '[{"title": "Sport handling: ", "text": "Stiff sidewalls enable precise cornering feedback."}, {"title": "Stability: ", "text": "Continuous centre rib enhances straight-line tracking."}]'
),
(
  'b1000000-0000-0000-0000-000000000009',
  'TYR-CTL-CC6-185',
  'continental-comfortcontact-cc6-185-65r15',
  'Continental ComfortContact CC6 — 185/65R15',
  'City comfort tyre designed for quiet rides and fuel efficiency.',
  'a1000000-0000-0000-0000-000000000001',
  'Continental',
  'new',
  'oem',
  '["https://images.unsplash.com/photo-1527266258038-6ae3e089a609?w=600&h=450&fit=crop", "https://images.unsplash.com/photo-1623706897185-32d543db92cf?w=600&h=450&fit=crop"]',
  '{"size": "185/65R15", "load_index": "88H", "speed_rating": "H"}',
  '[{"title": "Quiet ride: ", "text": "Noise-optimised tread pattern reduces cabin noise by 10%."}, {"title": "Fuel saver: ", "text": "Green compound for lower rolling resistance."}]'
),

-- New Engine Parts
(
  'b1000000-0000-0000-0000-000000000010',
  'ENG-BSH-AIR-FL',
  'bosch-air-filter-s0340',
  'Bosch Air Filter S 0340',
  'Premium engine air filter for Toyota, Honda, and Hyundai models.',
  'a1000000-0000-0000-0000-000000000002',
  'Bosch',
  'new',
  'oem',
  '["https://images.pexels.com/photos/159293/car-engine-motor-clean-customized-159293.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/10108616/pexels-photo-10108616.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"type": "Panel filter", "filtration": "99.5%", "material": "Multi-layer fleece"}',
  '[{"title": "High filtration: ", "text": "Captures 99.5% of dust and pollen particles."}, {"title": "Easy install: ", "text": "Drop-in replacement — no tools required."}]'
),
(
  'b1000000-0000-0000-0000-000000000011',
  'ENG-DNO-BRK-PAD',
  'denso-iridium-power-spark-iw20',
  'Denso Iridium Power Spark Plug IW20',
  'Ultra-fine iridium tip spark plug for superior ignitability and fuel economy.',
  'a1000000-0000-0000-0000-000000000002',
  'Denso',
  'new',
  'oem',
  '["https://images.pexels.com/photos/36086528/pexels-photo-36086528.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/8651903/pexels-photo-8651903.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"thread_size": "14mm", "tip": "0.4mm iridium", "gap": "0.8mm"}',
  '[{"title": "Iridium tip: ", "text": "0.4mm ultra-fine electrode for concentrated spark."}, {"title": "Fuel savings: ", "text": "Up to 5% fuel economy improvement."}]'
),
(
  'b1000000-0000-0000-0000-000000000012',
  'ENG-GAT-TMBLT',
  'gates-timing-belt-t313',
  'Gates PowerGrip Timing Belt T313',
  'OE-specification timing belt for Honda Civic, CR-V, and Accord 2.0L engines.',
  'a1000000-0000-0000-0000-000000000002',
  'Gates',
  'new',
  'oes',
  '["https://images.pexels.com/photos/5158168/pexels-photo-5158168.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/10108616/pexels-photo-10108616.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"teeth": "113", "width": "25.4mm", "material": "HNBR compound"}',
  '[{"title": "Heat resistant: ", "text": "HNBR compound handles temps up to 150°C."}, {"title": "OE spec: ", "text": "Meets manufacturer interval requirements."}]'
),
(
  'b1000000-0000-0000-0000-000000000013',
  'ENG-BRK-PAD-FR',
  'brembo-front-brake-pads-p85020',
  'Brembo Front Brake Pads P85020',
  'Premium ceramic front brake pads for Toyota Corolla, Camry, and RAV4.',
  'a1000000-0000-0000-0000-000000000002',
  'Brembo',
  'new',
  'aftermarket',
  '["https://images.pexels.com/photos/8651903/pexels-photo-8651903.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/159293/car-engine-motor-clean-customized-159293.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"type": "Ceramic", "position": "Front", "thickness": "14.5mm"}',
  '[{"title": "Low dust: ", "text": "Ceramic compound produces 80% less brake dust."}, {"title": "Quiet: ", "text": "Anti-squeal shim eliminates brake noise."}]'
),

-- New Accessories
(
  'b1000000-0000-0000-0000-000000000014',
  'ACC-DSH-CAM-FHD',
  'viofo-a119-mini-dashcam',
  'VIOFO A119 Mini Dash Cam — 2K QHD',
  'Compact 2K dash cam with superior night vision and built-in Wi-Fi.',
  'a1000000-0000-0000-0000-000000000003',
  'VIOFO',
  'new',
  'aftermarket',
  '["https://images.pexels.com/photos/10108616/pexels-photo-10108616.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/5158168/pexels-photo-5158168.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"resolution": "2560x1440p", "sensor": "Sony STARVIS IMX335", "storage": "microSD up to 256GB"}',
  '[{"title": "Night vision: ", "text": "Sony STARVIS sensor captures clear footage in low light."}, {"title": "Parking mode: ", "text": "Motion-triggered recording when parked."}]'
),
(
  'b1000000-0000-0000-0000-000000000015',
  'ACC-PHONE-MNT',
  'baseus-gravity-phone-mount',
  'Baseus Gravity Car Phone Mount',
  'Air vent gravity phone holder with auto-lock for 4.7–6.7 inch phones.',
  'a1000000-0000-0000-0000-000000000003',
  'Baseus',
  'new',
  'aftermarket',
  '["https://images.pexels.com/photos/3354648/pexels-photo-3354648.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/3354647/pexels-photo-3354647.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"mount_type": "Air vent clip", "phone_size": "4.7-6.7 inch", "material": "ABS + silicone"}',
  '[{"title": "Auto-lock: ", "text": "Gravity mechanism secures phone instantly."}, {"title": "360° rotation: ", "text": "Ball joint allows portrait or landscape viewing."}]'
),
(
  'b1000000-0000-0000-0000-000000000016',
  'ACC-LED-HEADLMP',
  'philips-ultinon-led-h7',
  'Philips Ultinon Pro LED H7 Headlight Bulb',
  'Street-legal LED replacement headlight bulb with 250% brighter beam.',
  'a1000000-0000-0000-0000-000000000003',
  'Philips',
  'new',
  'aftermarket',
  '["https://images.unsplash.com/photo-1444947295498-07f60c19a4ff?w=600&h=450&fit=crop", "https://images.unsplash.com/photo-1629086301886-7a59783e50e7?w=600&h=450&fit=crop"]',
  '{"base": "H7", "lumens": "5800", "color_temp": "5800K cool white"}',
  '[{"title": "250% brighter: ", "text": "Powerful beam extends visibility at night."}, {"title": "Plug & play: ", "text": "Direct replacement — no wiring modifications."}]'
),
(
  'b1000000-0000-0000-0000-000000000017',
  'ACC-SEAT-CVR-SET',
  'universal-leather-seat-cover-set',
  'Universal PU Leather Seat Cover Set — 5 Seats',
  'Premium faux leather seat covers with lumbar support padding for 5-seat vehicles.',
  'a1000000-0000-0000-0000-000000000003',
  'Motoka',
  'new',
  'aftermarket',
  '["https://images.pexels.com/photos/3354648/pexels-photo-3354648.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/5158168/pexels-photo-5158168.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"material": "PU Leather", "seats": "5-seat set (front + rear)", "color": "Black with red stitching"}',
  '[{"title": "Lumbar support: ", "text": "Built-in padded cushion reduces back fatigue."}, {"title": "Easy install: ", "text": "Elastic straps and hooks — no tools needed."}]'
),
(
  'b1000000-0000-0000-0000-000000000018',
  'ACC-FLOOR-MAT',
  'all-weather-rubber-floor-mats',
  'All-Weather Rubber Floor Mats — Universal 4pc',
  'Heavy-duty rubber floor mats with deep channels to trap mud, water, and debris.',
  'a1000000-0000-0000-0000-000000000003',
  'Motoka',
  'new',
  'aftermarket',
  '["https://images.pexels.com/photos/3354647/pexels-photo-3354647.jpeg?auto=compress&cs=tinysrgb&w=600", "https://images.pexels.com/photos/3354648/pexels-photo-3354648.jpeg?auto=compress&cs=tinysrgb&w=600"]',
  '{"material": "Thermoplastic rubber", "pieces": "4 (2 front + 2 rear)", "trimmable": "Yes"}',
  '[{"title": "Deep grooves: ", "text": "Channels trap water and mud to keep your car clean."}, {"title": "Trimmable: ", "text": "Cut to fit any vehicle — scissors are all you need."}]'
)
ON CONFLICT (slug) DO NOTHING;

-- Inventory for new parts
INSERT INTO public.ladipo_part_inventory (part_id, price_kobo, stock_qty, seller_label) VALUES
  ('b1000000-0000-0000-0000-000000000007',  7500000, 15, 'Motoka'),  -- ₦75,000
  ('b1000000-0000-0000-0000-000000000008',  9800000,  6, 'Motoka'),  -- ₦98,000
  ('b1000000-0000-0000-0000-000000000009',  5500000, 20, 'Motoka'),  -- ₦55,000
  ('b1000000-0000-0000-0000-000000000010',   850000, 35, 'Motoka'),  -- ₦8,500
  ('b1000000-0000-0000-0000-000000000011',   550000, 45, 'Motoka'),  -- ₦5,500
  ('b1000000-0000-0000-0000-000000000012',  1500000, 25, 'Motoka'),  -- ₦15,000
  ('b1000000-0000-0000-0000-000000000013',  2200000, 30, 'Motoka'),  -- ₦22,000
  ('b1000000-0000-0000-0000-000000000014',  4500000, 10, 'Motoka'),  -- ₦45,000
  ('b1000000-0000-0000-0000-000000000015',   350000, 40, 'Motoka'),  -- ₦3,500
  ('b1000000-0000-0000-0000-000000000016',  2800000, 20, 'Motoka'),  -- ₦28,000
  ('b1000000-0000-0000-0000-000000000017',  3500000, 15, 'Motoka'),  -- ₦35,000
  ('b1000000-0000-0000-0000-000000000018',   750000, 30, 'Motoka')   -- ₦7,500
ON CONFLICT DO NOTHING;
