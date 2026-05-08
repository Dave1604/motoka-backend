-- =============================================
-- Migration 053: Add more Ladipo marketplace products
-- Extends the Autofactor-derived catalog with more SKUs
-- for browse, detail, cart, and checkout testing.
-- =============================================

INSERT INTO public.ladipo_parts (
  id,
  sku,
  slug,
  name,
  description,
  category_id,
  brand,
  condition,
  part_type,
  images,
  specifications,
  key_features
) VALUES
(
  'b2000000-0000-0000-0000-000000000013',
  'AF-SCT-SM5016',
  'sct-genuine-oil-filter-sm5016',
  'SCT Genuine Oil Filter SM5016',
  'German-made service oil filter built for dependable daily maintenance with strong dirt-trapping performance.',
  'a2000000-0000-0000-0000-000000000021',
  'SCT Germany',
  'new',
  'aftermarket',
  '[
    "https://autofactorng.com/images/products/l/P1oGxvCElQ9IM7ZZ511k9Mb1Tu5dYC9iOGREGZ4s.jpg"
  ]'::jsonb,
  '{"part_number":"SM5016","filter_type":"Spin-on","origin":"Germany"}'::jsonb,
  '[{"title":"Tested quality","text":"SCT Germany filter element built for reliable routine service."},{"title":"Clean oil support","text":"Helps trap residue and particles before they circulate through the engine."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000014',
  'AF-SCT-SM121',
  'sct-genuine-oil-filter-sm121',
  'SCT Genuine Oil Filter SM121',
  'Affordable German oil filter option for quick maintenance work and stable everyday lubrication flow.',
  'a2000000-0000-0000-0000-000000000021',
  'SCT Germany',
  'new',
  'aftermarket',
  '[
    "https://autofactorng.com/images/products/l/BOw9rZqW1jzbwu1ile9ILX2BDvUC5JUC4wi2GQai.webp"
  ]'::jsonb,
  '{"part_number":"SM121","filter_type":"Spin-on","origin":"Germany"}'::jsonb,
  '[{"title":"Service-friendly pick","text":"Well-priced filter for periodic oil changes."},{"title":"Solid filtration","text":"Designed to reduce contaminant circulation in everyday driving."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000015',
  'AF-MOBIL1-5W30-5QT',
  'mobil-1-5w-30-extended-performance-high-mileage-full-synthetic-5-quarts',
  'Mobil 1 5W-30 Extended Performance High Mileage Full Synthetic Motor Oil 5 Quarts',
  'Premium high-mileage synthetic oil designed for longer service intervals, deposit control, and wear protection.',
  'a2000000-0000-0000-0000-000000000031',
  'Mobil 1',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/Dfvf4kHQl4JVSvOUQgYN0px5R9din8y9l40DZ1Ja.webp",
    "https://autofactorng.com/images/products/l/EZC2twwQm94gz8pe4PHJnYpBIqV99Ga8aglOxuk9.webp",
    "https://autofactorng.com/images/products/l/LQJpXvQbNg5JddOynX83QwBXa9sgzojCDHZVCPNP.webp"
  ]'::jsonb,
  '{"viscosity":"5W-30","volume":"5 quarts","oil_type":"Full synthetic","origin":"USA"}'::jsonb,
  '[{"title":"High-mileage formula","text":"Built for engines with more use and longer maintenance intervals."},{"title":"Heat protection","text":"Supports engine cleanliness and wear resistance under demanding driving."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000016',
  'AF-MOBIL1-5W40-EU',
  'mobil-1-5w-40-advanced-full-synthetic-motor-oil-5-quarts-european-car-formula',
  'Mobil 1 5W-40 Advanced Full Synthetic Motor Oil 5 Quarts European Car Formula',
  'European-car formula synthetic oil built for strong cleaning power, stable viscosity, and high-temperature protection.',
  'a2000000-0000-0000-0000-000000000031',
  'Mobil 1',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/j7hFN09xXEb76OcqnzbrrfDR3drIKutuOujB7EVs.png"
  ]'::jsonb,
  '{"viscosity":"5W-40","volume":"5 quarts","oil_type":"Full synthetic","fitment":"European petrol and diesel engines"}'::jsonb,
  '[{"title":"Euro formula","text":"Tuned for the needs of modern European engine platforms."},{"title":"Strong thermal stability","text":"Maintains protection under heat and extended driving conditions."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000017',
  'AF-KYB-3410123',
  'kyb-front-shocks-struts-3410123-pair',
  'KYB Front Shocks/Struts (3410123) Pair',
  'Front strut pair designed to restore ride comfort, control, and confident front-end response.',
  'a2000000-0000-0000-0000-000000000012',
  'KYB',
  'new',
  'oes',
  '[
    "https://autofactorng.com/images/products/l/GZlGBA4N3zcxWQ3kwwlJebzQgkbiUOyRODo0FUoD.jpg"
  ]'::jsonb,
  '{"part_number":"3410123","position":"Front","quantity":"Pair","origin":"Japan"}'::jsonb,
  '[{"title":"Ride comfort restore","text":"Helps bring back factory-like damping and front-end balance."},{"title":"Matched pair","text":"Left and right front struts supplied together for a more even repair."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000018',
  'AF-RCA-52390SWAA00',
  'genuine-rear-lower-control-arm-non-adjustable-52390swaa00-pair',
  'Genuine Rear Lower Control Arm Non-Adjustable (52390SWAA00) Pair',
  'Rear lower control arm pair built to tighten rear suspension geometry and reduce loose handling from worn links.',
  'a2000000-0000-0000-0000-000000000012',
  'Generic Genuine',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/rny2Jl9prw2eDNvLeNK2B4ITFkIQ9zw4zRmaCJ4M.jpg"
  ]'::jsonb,
  '{"part_number":"52390SWAA00","position":"Rear lower","quantity":"Pair","type":"Non-adjustable"}'::jsonb,
  '[{"title":"Rear-end stability","text":"Helps reduce unwanted rear suspension play and alignment drift."},{"title":"Left and right included","text":"Complete pair supports a cleaner rear suspension refresh."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000019',
  'AF-FBL-AFP654',
  'fbl-japan-genuine-rear-brake-pad-set-afp654',
  'FBL Japan Genuine Rear Brake Pad Set (AFP654)',
  'Premium ceramic rear brake pad set for quieter braking and dependable stopping feel in daily use.',
  'a2000000-0000-0000-0000-000000000011',
  'FBL Japan',
  'new',
  'aftermarket',
  '[
    "https://autofactorng.com/images/products/l/Vq5tbYDolM5eBjtfRam1Z22Z457jPpEnoIQlIgor.png"
  ]'::jsonb,
  '{"part_number":"AFP654","position":"Rear","compound":"Premium ceramic","origin":"Japan"}'::jsonb,
  '[{"title":"Low-noise braking","text":"Ceramic pad compound helps keep the brake feel cleaner and quieter."},{"title":"Service-ready set","text":"Convenient rear axle replacement set for routine brake jobs."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000020',
  'AF-MB-A0004205202',
  'mercedes-benz-oem-rear-brake-pad-set-a0004205202',
  'Mercedes Benz OEM Rear Brake Pad Set (A0004205202)',
  'OEM rear brake pad set for Mercedes-Benz applications, tuned for strong bite and premium braking feel.',
  'a2000000-0000-0000-0000-000000000011',
  'Mercedes-Benz',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/czrShvbvzOpThyBV8K8kRlY6jPgPS6nXMLJNtBCn.png"
  ]'::jsonb,
  '{"part_number":"A0004205202","position":"Rear","fitment":"Mercedes-Benz","compound":"OEM ceramic"}'::jsonb,
  '[{"title":"OEM braking balance","text":"Keeps braking response aligned with factory Mercedes-Benz feel."},{"title":"Premium replacement","text":"Good fit for owners looking for original-style stopping performance."}]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.ladipo_part_inventory (part_id, price_kobo, stock_qty, seller_label) VALUES
  ('b2000000-0000-0000-0000-000000000013',  700000, 18, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000014',  600000, 18, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000015', 8000000, 12, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000016', 8000000, 10, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000017',17500000,  6, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000018', 3000000, 10, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000019', 7000000,  8, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000020',10000000,  6, 'Motoka')
ON CONFLICT DO NOTHING;
