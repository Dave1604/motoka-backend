-- =============================================
-- Migration 052: Reseed Ladipo with Autofactor-derived catalog
-- Replaces the placeholder marketplace seed with a tighter,
-- image-backed catalog for UI and checkout testing.
-- =============================================

-- Remove previous catalog seed while keeping orders intact.
DELETE FROM public.ladipo_part_inventory;
DELETE FROM public.ladipo_parts;
DELETE FROM public.ladipo_categories;

-- Categories
INSERT INTO public.ladipo_categories (id, name, slug, parent_id, sort_order) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'Spare Parts', 'spare-parts', null, 1),
  ('a2000000-0000-0000-0000-000000000002', 'Servicing Parts', 'servicing-parts', null, 2),
  ('a2000000-0000-0000-0000-000000000003', 'Lubricants / Fluids', 'lubricants-fluids', null, 3),
  ('a2000000-0000-0000-0000-000000000011', 'Brake & Wheel Hub / Bearings', 'spare-parts-brake-wheel-hub-bearings', 'a2000000-0000-0000-0000-000000000001', 1),
  ('a2000000-0000-0000-0000-000000000012', 'Suspension Parts', 'spare-parts-suspension-parts', 'a2000000-0000-0000-0000-000000000001', 2),
  ('a2000000-0000-0000-0000-000000000021', 'Oil Filter', 'servicing-parts-oil-filter', 'a2000000-0000-0000-0000-000000000002', 1),
  ('a2000000-0000-0000-0000-000000000031', 'Engine Oil', 'lubricants-fluids-engine-oil', 'a2000000-0000-0000-0000-000000000003', 1);

-- Parts
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
  'b2000000-0000-0000-0000-000000000001',
  'AF-KH-263502J000',
  'genuine-kia-hyundai-oil-filter-263502j000',
  'Genuine KIA/Hyundai Oil Filter 263502J000',
  'Original cartridge oil filter for Hyundai and KIA applications, built for cleaner oil flow and dependable engine protection.',
  'a2000000-0000-0000-0000-000000000021',
  'KIA / Hyundai',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/AL9YomQwq4wyZqTYNWEhJVwaySNcSfQ7dxD2Vu4M.webp",
    "https://autofactorng.com/images/products/l/EvaL76NkRnGtlAhWpwCrEfv4KuoGKbpgsZgudeEV.jpg"
  ]'::jsonb,
  '{"part_number":"263502J000","filter_type":"Cartridge","fitment":"Multiple Hyundai and KIA engines","origin":"Korea"}'::jsonb,
  '[{"title":"OEM fit","text":"Direct-fit filter designed around Hyundai and KIA factory requirements."},{"title":"Cleaner oil flow","text":"Synthetic blend media helps trap contaminants before they circulate through the engine."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000002',
  'AF-VW-070115562',
  'volkswagen-genuine-oil-filter-070115562',
  'Volkswagen Genuine Oil Filter (070115562)',
  'Genuine Volkswagen oil filter with cartridge design and stable flow characteristics for European engines.',
  'a2000000-0000-0000-0000-000000000021',
  'Volkswagen',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/iDebpZIZiUjeI4O5B9SEre3blCdpcYbggUMpxY9V.webp"
  ]'::jsonb,
  '{"part_number":"070115562","filter_type":"Cartridge","fitment":"Volkswagen applications","origin":"Germany"}'::jsonb,
  '[{"title":"Genuine VW part","text":"Built for factory-spec filtration and fitment."},{"title":"Direct replacement","text":"Fast install for routine service work without modification."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000003',
  'AF-FRAM-CH10358',
  'fram-ch10358-oil-filter',
  'FRAM CH10358 Oil Filter',
  'Everyday service oil filter with blended media for routine maintenance and strong value pricing.',
  'a2000000-0000-0000-0000-000000000021',
  'FRAM',
  'new',
  'aftermarket',
  '[
    "https://autofactorng.com/images/products/l/E2hfqbeYtGBU5dezwa8d3u16eU5VTfxlPKBM6CMv.jpg",
    "https://autofactorng.com/images/products/l/oPscmOSi7ujIq1lhnUFY468sMRYDvL0gxDwcOm9h.png"
  ]'::jsonb,
  '{"part_number":"CH10358","oem_reference":"04152-37010","filter_type":"Cartridge","origin":"USA"}'::jsonb,
  '[{"title":"Budget-friendly service part","text":"Affordable replacement for quick maintenance cycles."},{"title":"Blended filter media","text":"Cellulose and glass media support everyday engine protection."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000004',
  'AF-MOBIL1-0W20-6PK',
  'mobil-1-0w-20-extended-performance-synthetic-motor-oil-pack-of-6',
  'Mobil 1 0W-20 Extended Performance Synthetic Motor Oil 1 Quart (Pack of 6)',
  'High-end synthetic engine oil pack engineered for long drain intervals, strong wear protection, and cleaner internals.',
  'a2000000-0000-0000-0000-000000000031',
  'Mobil 1',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/WW9CAstBVD2Giz6cBUn7iOOTPQPht6IWqcSGjylD.jpg",
    "https://autofactorng.com/images/products/l/sLWod2WYmHo55QgMOpNIQJCGDZ944yL0wiAuWUwc.webp",
    "https://autofactorng.com/images/products/l/7Kdgc1Ok3Wy1Qq3Kd8a9RzEwYuhBmJk5UboNwz1x.webp"
  ]'::jsonb,
  '{"viscosity":"0W-20","volume":"6 x 1 quart","oil_type":"Full synthetic","origin":"USA"}'::jsonb,
  '[{"title":"Extended performance","text":"Designed for longer service intervals with strong oxidation resistance."},{"title":"Engine cleanliness","text":"Helps reduce deposits and sludge while protecting under heat."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000005',
  'AF-MANNOL-15W40-5L',
  'mannol-universal-15w-40-engine-oil-5liters',
  'MANNOL Universal 15W-40 Engine Oil 5 Liters',
  'Versatile mineral-based engine oil for older petrol and diesel vehicles needing durable everyday lubrication.',
  'a2000000-0000-0000-0000-000000000031',
  'MANNOL',
  'new',
  'aftermarket',
  '[
    "https://autofactorng.com/images/products/l/j5RTR0vGQ1AiPcmZB2ctAGQIZXY5wNt0nZAvqGVo.png"
  ]'::jsonb,
  '{"viscosity":"15W-40","volume":"5 liters","oil_type":"Mineral","origin":"Germany"}'::jsonb,
  '[{"title":"Strong value option","text":"Well-priced engine oil for daily-use vehicles and regular maintenance."},{"title":"Broad compatibility","text":"Suitable for a wide range of older engines that call for 15W-40 oil."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000006',
  'AF-MANNOL-20W50-1L',
  'mannol-safari-20w-50-engine-oil-1liter',
  'MANNOL Safari 20W-50 Engine Oil 1 Liter',
  'Single-liter mineral engine oil for top-ups or short service intervals in vehicles that run heavier viscosity oil.',
  'a2000000-0000-0000-0000-000000000031',
  'MANNOL',
  'new',
  'aftermarket',
  '[
    "https://autofactorng.com/images/products/l/7tAnQviz9VjOgUIxRaRUWJUVFSWKmfnmbYoglmZm.png"
  ]'::jsonb,
  '{"viscosity":"20W-50","volume":"1 liter","oil_type":"Mineral","note":"Top-up friendly size"}'::jsonb,
  '[{"title":"Convenient size","text":"Useful for top-ups, emergency replacement, or small service jobs."},{"title":"Heavy-viscosity support","text":"Suitable for engines that perform best with thicker mineral oil."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000007',
  'AF-BJ-4333009B60',
  'genuine-front-lower-arm-balljoint-4333009b60-pair',
  'Genuine Front Lower Arm Balljoint (4333009B60) Pair',
  'Front lower arm balljoint set with press-in mounting and corrosion-resistant finish for tighter steering response.',
  'a2000000-0000-0000-0000-000000000012',
  'Generic Genuine',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/YHv5AmGHYaqYObQc53LHUvaxPMbgXef5OnY0yAJV.png"
  ]'::jsonb,
  '{"part_number":"4333009B60","position":"Front lower","quantity":"Pair","origin":"Taiwan"}'::jsonb,
  '[{"title":"Pair set","text":"Ships as left and right components for a cleaner suspension refresh."},{"title":"Ready to install","text":"Includes mounting hardware with pre-greased joint design."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000008',
  'AF-ARM-54501AA100-PAIR',
  'genuine-front-lower-control-arm-54501aa100-54500aa100-pair',
  'Genuine Front Lower Control Arm (54501AA100 & 54500AA100) Pair',
  'Stamped steel lower control arm pair with ball joints included for restoring stability and suspension geometry.',
  'a2000000-0000-0000-0000-000000000012',
  'Generic Genuine',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/13dbw2Q7mmZD6PjKGMxSKCpZdckEZC7L8GXimgdE.jpg"
  ]'::jsonb,
  '{"part_numbers":"54501AA100 / 54500AA100","position":"Front lower","material":"Stamped steel","quantity":"Pair"}'::jsonb,
  '[{"title":"Suspension refresh","text":"Good fit for worn front-end setups with noisy bushings or loose handling."},{"title":"Complete assembly","text":"Ball joints are already integrated to reduce installation work."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000009',
  'AF-HKM-54830S8000',
  'genuine-hyundai-kia-front-stabilizer-linkage-54830s8000-pair',
  'Genuine Hyundai/KIA Front Stabilizer Linkage (54830S8000) Pair',
  'Front stabilizer linkage pair that helps reduce body roll and improves planted feel through corners and rough roads.',
  'a2000000-0000-0000-0000-000000000012',
  'Hyundai Mobis',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/N90xXnVumAbbTt4gS13rrb1acNnllNwqYtgpXiOT.jpg",
    "https://autofactorng.com/images/products/l/gNUGDdbIe4hCaTMjFihzFd5lofheLyPnR0N9g7M4.jpg"
  ]'::jsonb,
  '{"part_number":"54830S8000","position":"Front","quantity":"Pair","origin":"Korea"}'::jsonb,
  '[{"title":"Body-roll control","text":"Helps keep the vehicle flatter and more predictable in turns."},{"title":"OEM linkage set","text":"Includes left and right pieces for a balanced repair."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000010',
  'AF-TOY-0446630210',
  'toyota-oem-rear-brake-pad-set-04466-30210',
  'Toyota OEM Rear Brake Pad Set (04466-30210)',
  'Premium ceramic rear brake pad set with Toyota OEM fitment for confident stopping and quieter braking.',
  'a2000000-0000-0000-0000-000000000011',
  'Toyota',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/a9WQ17QfipfcDmnwqXSh3PcXcOuAv260MGeGL7HM.webp"
  ]'::jsonb,
  '{"part_number":"04466-30210","position":"Rear","compound":"Premium ceramic","quantity":"Set"}'::jsonb,
  '[{"title":"OEM brake feel","text":"Built to preserve Toyota stopping response and quiet operation."},{"title":"Ceramic compound","text":"Reduced dust with stable braking during daily driving."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000011',
  'AF-ROTOR-424310E020',
  'genuine-coated-rear-brake-rotor-disc-assy-424310e020-pair',
  'Genuine Coated Rear Brake Rotor / Disc Assy (424310E020) Pair',
  'Coated rear brake rotor pair for cleaner installation, stronger corrosion resistance, and consistent braking feel.',
  'a2000000-0000-0000-0000-000000000011',
  'Generic Genuine',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/9K2Jl53jNafs2ENEcRQV4AJPQnqaPdGYOMqI5KIZ.png"
  ]'::jsonb,
  '{"part_number":"424310E020","position":"Rear","finish":"Premium coated","quantity":"Pair"}'::jsonb,
  '[{"title":"Corrosion-resistant finish","text":"Coated surfaces help the rotors stay cleaner after install."},{"title":"Pair package","text":"Both rear rotors are included for even braking performance."}]'::jsonb
),
(
  'b2000000-0000-0000-0000-000000000012',
  'AF-ABS-895450K240-PAIR',
  'toyota-rear-abs-wheel-speed-sensor-895450k240-895460k240-pair',
  'Toyota Rear ABS Wheel Speed Sensor (895450K240 & 895460K240) Pair',
  'Rear ABS wheel speed sensor pair for restoring traction, ABS response, and stable braking electronics.',
  'a2000000-0000-0000-0000-000000000011',
  'Toyota',
  'new',
  'oem',
  '[
    "https://autofactorng.com/images/products/l/yi80Ugih9wZX4t4xrjpwb75Yhkq7lq4LJTWycKFO.jpg"
  ]'::jsonb,
  '{"part_numbers":"895450K240 / 895460K240","position":"Rear","quantity":"Pair","fitment":"Toyota applications"}'::jsonb,
  '[{"title":"ABS restore","text":"Helps fix wheel-speed signal loss that can trigger warning lights."},{"title":"Left and right set","text":"Matched pair supports a complete rear axle replacement."}]'::jsonb
);

-- Inventory
INSERT INTO public.ladipo_part_inventory (part_id, price_kobo, stock_qty, seller_label) VALUES
  ('b2000000-0000-0000-0000-000000000001',  750000, 18, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000002',  550000, 14, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000003',  300000, 22, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000004', 7400000, 10, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000005', 3300000, 16, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000006',  900000, 20, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000007', 1800000, 12, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000008',11000000,  6, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000009', 2500000, 14, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000010', 7500000, 10, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000011', 6800000,  8, 'Motoka'),
  ('b2000000-0000-0000-0000-000000000012', 4000000, 10, 'Motoka');
