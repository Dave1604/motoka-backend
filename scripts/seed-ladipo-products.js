import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { uploadToCloudinary } from '../src/services/fileUpload.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const DEFAULT_COUNT = 3000;
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_SELLER = 'Ladipo Market';

const MAKES_AND_MODELS = [
  { make: 'Toyota', models: ['Camry', 'Corolla', 'RAV4', 'Highlander'] },
  { make: 'Honda', models: ['Accord', 'Civic', 'CR-V', 'Pilot'] },
  { make: 'Lexus', models: ['RX 350', 'ES 350', 'GX 460'] },
  { make: 'Nissan', models: ['Altima', 'Sentra', 'X-Trail', 'Patrol'] },
  { make: 'Hyundai', models: ['Elantra', 'Santa Fe', 'Tucson'] },
  { make: 'Kia', models: ['Sportage', 'Sorento', 'Cerato'] },
  { make: 'Mercedes-Benz', models: ['C300', 'E350', 'GLK 350'] },
  { make: 'BMW', models: ['320i', 'X3', 'X5'] },
];

const BASE_PRODUCTS = [
  'Brake Pad Set',
  'Brake Disc Rotor',
  'Shock Absorber',
  'Strut Mount',
  'Wheel Bearing',
  'Control Arm',
  'Tie Rod End',
  'Ball Joint',
  'Engine Mount',
  'Radiator',
  'Water Pump',
  'Thermostat',
  'Ignition Coil',
  'Spark Plug Set',
  'Fuel Pump',
  'Fuel Injector',
  'Air Filter',
  'Cabin Filter',
  'Oil Filter',
  'Timing Belt Kit',
  'Drive Belt',
  'Headlight Assembly',
  'Taillight Assembly',
  'Side Mirror',
  'Wiper Blade',
];

function parseArgs(argv) {
  const options = {
    count: DEFAULT_COUNT,
    batchSize: DEFAULT_BATCH_SIZE,
    seller: DEFAULT_SELLER,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--count' && next) {
      options.count = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--batch' && next) {
      options.batchSize = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--seller' && next) {
      options.seller = String(next);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new Error('--count must be a positive integer');
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000) {
    throw new Error('--batch must be an integer between 1 and 1000');
  }

  return options;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildImageSvg(productName, categoryName, brand) {
  const label = `${brand} ${categoryName} ${productName}`.replace(/\s+/g, ' ').trim();
  const safeLabel = escapeXml(label.slice(0, 90));
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
      <rect width="1200" height="800" fill="#0f172a" />
      <rect x="48" y="48" width="1104" height="704" rx="24" fill="#111827" stroke="#3b82f6" stroke-width="6" />
      <circle cx="280" cy="280" r="140" fill="#2563eb" opacity="0.75" />
      <circle cx="890" cy="520" r="180" fill="#1d4ed8" opacity="0.6" />
      <rect x="180" y="520" width="840" height="120" rx="18" fill="#f8fafc" opacity="0.16" />
      <text x="600" y="310" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#f8fafc">${safeLabel}</text>
      <text x="600" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#bfdbfe">Ladipo Auto Parts</text>
      <text x="600" y="590" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#e2e8f0">High-quality parts for vehicle compatibility</text>
    </svg>
  `.trim();
}

async function buildImageUrl(productName, categoryName, brand, slug) {
  const svg = buildImageSvg(productName, categoryName, brand);
  const buffer = Buffer.from(svg, 'utf8');
  return uploadToCloudinary(buffer, `${slug}.svg`, 'image/svg+xml');
}

async function buildProductData(categories, count, sellerLabel) {
  const nowSeed = Date.now();
  const childCategories = categories.filter((c) => c.parent_id);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  if (childCategories.length === 0) {
    throw new Error('No Ladipo subcategories found. Seed categories first.');
  }

  const parts = [];
  const inventories = [];
  const compatibilities = [];

  for (let i = 0; i < count; i += 1) {
    const category = pickRandom(childCategories);
    const parent = categoriesById.get(category.parent_id);
    const parentSlug = (parent?.slug || '').toLowerCase();
    const isUniversal = parentSlug.startsWith('lubricants-fluids')
      || parentSlug.startsWith('accessories')
      || parentSlug.startsWith('servicing-parts');

    const productBase = pickRandom(BASE_PRODUCTS);
    const makeModel = pickRandom(MAKES_AND_MODELS);
    const model = pickRandom(makeModel.models);
    const yearStart = randomInt(2004, 2021);
    const yearEnd = Math.min(yearStart + randomInt(2, 8), 2025);
    const brand = isUniversal ? pickRandom(['Motul', 'Castrol', 'Mobil', 'Bosch', 'Denso', 'NGK']) : pickRandom([makeModel.make, 'Bosch', 'Denso', 'TRW', 'KYB', 'Febi']);

    const productName = isUniversal
      ? `${brand} ${productBase} ${randomInt(1, 999)}`
      : `${makeModel.make} ${model} ${productBase}`;
    const suffix = `${nowSeed}-${i + 1}`;
    const slug = `${slugify(productName)}-${suffix}`;
    const sku = `LDP-${String(nowSeed).slice(-6)}-${String(i + 1).padStart(6, '0')}`;

    const condition = pickRandom(['new', 'tokunbo', 'nigerian_used']);
    const partType = pickRandom(['aftermarket', 'oem', 'oes']);
    const priceKobo = randomInt(2500, 300000) * 100;
    const stockQty = randomInt(5, 250);
    const categoryName = parent?.name || category.name;
    const imageUrl = await buildImageUrl(productName, categoryName, brand, slug);

    parts.push({
      sku,
      slug,
      name: productName,
      description: isUniversal
        ? `${productName} suitable for multiple vehicle types.`
        : `${productName} compatible with specific year ranges.`,
      category_id: category.id,
      brand,
      condition,
      part_type: partType,
      images: [imageUrl],
      specifications: {
        origin: pickRandom(['Germany', 'Japan', 'Korea', 'USA', 'China']),
        warranty: `${randomInt(3, 12)} months`,
      },
      key_features: [
        { title: 'Quality', text: 'Selected from trusted market suppliers.' },
        { title: 'Supply', text: 'Sourced on-demand from local market.' },
      ],
      is_active: true,
      is_universal: isUniversal,
      _compatibilitySeed: isUniversal ? null : { make: makeModel.make, model, yearStart, yearEnd },
    });

    inventories.push({
      price_kobo: priceKobo,
      stock_qty: stockQty,
      seller_label: sellerLabel,
      _slug: slug,
    });
  }

  return { parts, inventories, compatibilities };
}

async function main() {
  const { count, batchSize, seller, dryRun } = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseAdmin();

  console.log(`[seed-ladipo] Starting product generation: count=${count}, batch=${batchSize}, dryRun=${dryRun}`);

  const { data: categories, error: categoryError } = await supabase
    .from('ladipo_categories')
    .select('id, name, slug, parent_id')
    .order('sort_order', { ascending: true });

  if (categoryError) {
    throw new Error(`Failed to fetch categories: ${categoryError.message}`);
  }

  const generated = await buildProductData(categories || [], count, seller);
  const parts = generated.parts;

  if (dryRun) {
    const universalCount = parts.filter((p) => p.is_universal).length;
    console.log(`[seed-ladipo] Dry run complete. Generated ${parts.length} products (${universalCount} universal).`);
    return;
  }

  let insertedParts = 0;
  let insertedInventory = 0;
  let insertedCompatibility = 0;

  for (let i = 0; i < parts.length; i += batchSize) {
    const slice = parts.slice(i, i + batchSize);
    const insertPayload = slice.map(({ _compatibilitySeed, ...part }) => part);

    const { data: inserted, error: insertError } = await supabase
      .from('ladipo_parts')
      .insert(insertPayload)
      .select('id, slug');

    if (insertError) {
      throw new Error(`Failed inserting parts batch ${i / batchSize + 1}: ${insertError.message}`);
    }

    const idBySlug = new Map((inserted || []).map((row) => [row.slug, row.id]));
    insertedParts += inserted?.length || 0;

    const inventoryPayload = [];
    const compatibilityPayload = [];

    for (const part of slice) {
      const partId = idBySlug.get(part.slug);
      if (!partId) continue;

      inventoryPayload.push({
        part_id: partId,
        price_kobo: randomInt(2500, 300000) * 100,
        stock_qty: randomInt(5, 250),
        seller_label: seller,
      });

      if (part._compatibilitySeed) {
        compatibilityPayload.push({
          part_id: partId,
          make: part._compatibilitySeed.make,
          model: part._compatibilitySeed.model,
          year_min: part._compatibilitySeed.yearStart,
          year_max: part._compatibilitySeed.yearEnd,
          notes: 'Seeded compatibility rule',
        });
      }
    }

    if (inventoryPayload.length > 0) {
      const { error: inventoryError } = await supabase
        .from('ladipo_part_inventory')
        .insert(inventoryPayload);
      if (inventoryError) {
        throw new Error(`Failed inserting inventory batch ${i / batchSize + 1}: ${inventoryError.message}`);
      }
      insertedInventory += inventoryPayload.length;
    }

    if (compatibilityPayload.length > 0) {
      const { error: compatibilityError } = await supabase
        .from('ladipo_part_compatibility')
        .insert(compatibilityPayload);
      if (compatibilityError) {
        throw new Error(`Failed inserting compatibility batch ${i / batchSize + 1}: ${compatibilityError.message}`);
      }
      insertedCompatibility += compatibilityPayload.length;
    }

    console.log(`[seed-ladipo] Batch ${Math.floor(i / batchSize) + 1} done (${Math.min(i + batchSize, parts.length)}/${parts.length})`);
  }

  console.log('[seed-ladipo] Completed');
  console.log(`[seed-ladipo] Parts inserted: ${insertedParts}`);
  console.log(`[seed-ladipo] Inventory inserted: ${insertedInventory}`);
  console.log(`[seed-ladipo] Compatibility inserted: ${insertedCompatibility}`);
}

main().catch((error) => {
  console.error(`[seed-ladipo] Fatal error: ${error.message}`);
  process.exit(1);
});
