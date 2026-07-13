import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { CANONICAL } from './lib/ladipoCanonicalCategories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const BASE_URL = 'https://www.ladipomarket.com.ng';
const DEFAULT_LIMIT = 5000;
const DEFAULT_PER_CATEGORY_LIMIT = 300;

function parseArgs(argv) {
  const options = {
    limit: DEFAULT_LIMIT,
    perCategoryLimit: DEFAULT_PER_CATEGORY_LIMIT,
    dryRun: false,
    sync: false,
    sellerLabel: 'Ladipo Market',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--per-category' && next) {
      options.perCategoryLimit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--seller' && next) {
      options.sellerLabel = String(next);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--sync') {
      options.sync = true;
    }
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  if (!Number.isInteger(options.perCategoryLimit) || options.perCategoryLimit < 1) {
    throw new Error('--per-category must be a positive integer');
  }
  return options;
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#8358;/g, '₦')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '-')
    .replace(/&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(value) {
  return normalizeSpace(decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'MotokaLadipoImporter/1.0 (+https://motoka.ng)',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.text();
}

function extractCategoryLinks(html) {
  const matches = html.matchAll(/href="https:\/\/www\.ladipomarket\.com\.ng\/category\/([^"#?]+)"/gi);
  const slugs = new Set();
  for (const m of matches) slugs.add(m[1].replace(/\/$/, ''));
  return [...slugs];
}

function inferBrand(title) {
  const normalized = normalizeSpace(title);
  const firstToken = normalized.split(' ')[0] || 'Ladipo Market';
  return firstToken.replace(/[^A-Za-z0-9/&.-]/g, '') || 'Ladipo Market';
}

// ladipomarket.com.ng's catalog is 100% vehicle-specific mechanical parts (engines,
// gearboxes, tyres, rims, batteries, etc.) - none of its categories are generic enough
// to be safely shown against every vehicle filter, so nothing here is marked universal.
// Maps raw ladipomarket.com.ng leaf category slugs onto the canonical taxonomy above.
// Anything not listed here falls back to the general "Spare Parts" bucket.
const CATEGORY_SLUG_MAP = {
  brakes: CANONICAL.BRAKE_WHEEL_HUB,
  hubs: CANONICAL.BRAKE_WHEEL_HUB,
  'ball-joints': CANONICAL.BRAKE_WHEEL_HUB,
  axles: CANONICAL.BRAKE_WHEEL_HUB,
  'tie-rods': CANONICAL.BRAKE_WHEEL_HUB,
  'lower-arms': CANONICAL.BRAKE_WHEEL_HUB,

  'shock-absorbers': CANONICAL.SUSPENSION,
  shocks: CANONICAL.SUSPENSION,
  stabilizers: CANONICAL.SUSPENSION,

  engines: CANONICAL.ENGINE_PARTS,
  cylinders: CANONICAL.ENGINE_PARTS,
  gaskets: CANONICAL.ENGINE_PARTS,
  flywheels: CANONICAL.ENGINE_PARTS,
  crankshafts: CANONICAL.ENGINE_PARTS,
  injectors: CANONICAL.ENGINE_PARTS,
  compressors: CANONICAL.ENGINE_PARTS,
  'water-pumps': CANONICAL.ENGINE_PARTS,
  radiators: CANONICAL.ENGINE_PARTS,
  'radiator-fans': CANONICAL.ENGINE_PARTS,
  'radiator-units': CANONICAL.ENGINE_PARTS,
  evaporators: CANONICAL.ENGINE_PARTS,
  condensers: CANONICAL.ENGINE_PARTS,
  ac: CANONICAL.ENGINE_PARTS,
  sensor: CANONICAL.ENGINE_PARTS,
  ignition: CANONICAL.ENGINE_PARTS,
  fuels: CANONICAL.ENGINE_PARTS,
  'fuel-pumps': CANONICAL.ENGINE_PARTS,
  'fuel-gauges': CANONICAL.ENGINE_PARTS,
  'fuel-tanks': CANONICAL.ENGINE_PARTS,

  steering: CANONICAL.STEERING_PARTS,
  'steering-pumps': CANONICAL.STEERING_PARTS,
  'steering-racks': CANONICAL.STEERING_PARTS,
  'steering-wheels': CANONICAL.STEERING_PARTS,

  exhausts: CANONICAL.EXHAUST,

  'oil-filters': CANONICAL.OIL_FILTER,
  'air-filters': CANONICAL.AIR_FILTER,
  plugs: CANONICAL.SPARK_PLUGS,
  'fuel-filters': CANONICAL.FUEL_FILTER,
  chains: CANONICAL.TIMING_BELTS,

  oils: CANONICAL.ENGINE_OIL,
  'oil-pumps': CANONICAL.ENGINE_OIL,

  'gear-boxes': CANONICAL.GEAR_OIL,
  gears: CANONICAL.GEAR_OIL,
  'gear-filters': CANONICAL.GEAR_OIL,
  'gear-pumps': CANONICAL.GEAR_OIL,

  tyres: CANONICAL.CAR_TYRES,
  'tyres-rims': CANONICAL.CAR_TYRES,
  rims: CANONICAL.ALLOY_WHEELS,
  'wheel-covers': CANONICAL.ALLOY_WHEELS,

  batteries: CANONICAL.CAR_BATTERIES,

  lamps: CANONICAL.BULBS_LIGHTING,
  'head-lamps': CANONICAL.BULBS_LIGHTING,
  'tail-lamps': CANONICAL.BULBS_LIGHTING,

  alternators: CANONICAL.ALTERNATORS,
  'kick-starters': CANONICAL.ALTERNATORS,
  'brain-boxes': CANONICAL.ALTERNATORS,
  switches: CANONICAL.ALTERNATORS,
  stereos: CANONICAL.ALTERNATORS,
  horns: CANONICAL.ALTERNATORS,

  dashboards: CANONICAL.INTERIOR,
  locks: CANONICAL.INTERIOR,

  bumpers: CANONICAL.EXTERIOR,
  grills: CANONICAL.EXTERIOR,
  fenders: CANONICAL.EXTERIOR,
  doors: CANONICAL.EXTERIOR,
  bonnets: CANONICAL.EXTERIOR,
  windscreens: CANONICAL.EXTERIOR,
  windows: CANONICAL.EXTERIOR,
  wipers: CANONICAL.EXTERIOR,
  mirrors: CANONICAL.EXTERIOR,
  'back-mirrors': CANONICAL.EXTERIOR,
  'front-mirrors': CANONICAL.EXTERIOR,
  'side-mirrors': CANONICAL.EXTERIOR,
  hangers: CANONICAL.EXTERIOR,
};

function resolveCanonicalCategoryId(categorySlug) {
  const leaf = String(categorySlug || '').split('/').pop();
  return CATEGORY_SLUG_MAP[leaf] || CANONICAL.SPARE_PARTS;
}

function extractTotalResults(html) {
  const match = html.match(/Showing\s+[\d,]+&ndash;[\d,]+\s+of\s+([\d,]+)\s+results/i)
    || html.match(/Showing\s+[\d,]+-[\d,]+\s+of\s+([\d,]+)\s+results/i);
  if (!match) return null;
  return Number.parseInt(match[1].replace(/,/g, ''), 10);
}

function extractProductsFromCategoryPage(html, categorySlug) {
  const products = [];
  const blockRegex = /<div class="row row-spacer-sm theme-bg-ash theme-product-box[\s\S]*?product_cat-[^"]*"[\s\S]*?>([\s\S]*?)<\/div>\s*(?:<div class="row row-spacer-sm theme-bg-ash theme-product-box|<\/ul>)/g;

  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1];

    const linkMatch = block.match(/href="(https:\/\/www\.ladipomarket\.com\.ng\/product\/[^"#?]+)"/i);
    if (!linkMatch) continue;
    const productUrl = linkMatch[1];
    const slug = slugify(productUrl.split('/product/')[1] || '');
    if (!slug) continue;

    const titleMatch = block.match(/<h4[^>]*>\s*([\s\S]*?)\s*<\/h4>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : null;
    if (!title) continue;

    const priceMatch = block.match(/&#8358;\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    const priceNaira = priceMatch ? Number.parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    const descMatch = block.match(/<\/h4>\s*<p>([\s\S]*?)<\/p>/i);
    const description = descMatch ? stripHtml(descMatch[1]) : title;

    const imageMatch = block.match(/background:\s*#fafafa url\(([^)]+)\)/i);
    const image = imageMatch ? imageMatch[1].trim() : null;

    products.push({
      source_url: productUrl,
      title,
      slug,
      sku: `LM-${slug.toUpperCase().slice(0, 24)}`,
      price_kobo: Number.isFinite(priceNaira) && priceNaira > 0 ? Math.round(priceNaira * 100) : null,
      image,
      description,
      brand: inferBrand(title),
      category_slug: categorySlug,
    });
  }

  return products;
}

async function crawlCategory(categorySlug, perCategoryLimit) {
  const collected = [];
  let page = 1;
  let totalResults = null;

  while (collected.length < perCategoryLimit) {
    const url = page === 1
      ? `${BASE_URL}/category/${categorySlug}`
      : `${BASE_URL}/category/${categorySlug}/page/${page}`;

    let html;
    try {
      html = await fetchHtml(url);
    } catch {
      break;
    }
    await sleep(200);

    if (totalResults === null) totalResults = extractTotalResults(html);

    const pageProducts = extractProductsFromCategoryPage(html, categorySlug);
    if (pageProducts.length === 0) break;

    collected.push(...pageProducts);

    if (totalResults !== null && collected.length >= totalResults) break;
    page += 1;
  }

  return collected.slice(0, perCategoryLimit);
}

async function crawlLadipoMarketProducts(limit, perCategoryLimit) {
  const categoriesHtml = await fetchHtml(`${BASE_URL}/categories`);
  const categorySlugs = extractCategoryLinks(categoriesHtml);
  console.log(`[import-ladipo-market] Discovered ${categorySlugs.length} categories`);

  const products = [];
  const seenSlugs = new Set();

  for (const categorySlug of categorySlugs) {
    const categoryProducts = await crawlCategory(categorySlug, perCategoryLimit);
    let added = 0;

    for (const product of categoryProducts) {
      if (seenSlugs.has(product.slug)) continue;
      seenSlugs.add(product.slug);
      products.push(product);
      added += 1;
      if (products.length >= limit) {
        console.log(`[import-ladipo-market] Hit overall limit ${limit}, stopping crawl`);
        return products;
      }
    }

    console.log(`[import-ladipo-market] Category ${categorySlug}: ${added} new products collected`);
  }

  return products;
}

async function syncToDatabase(products, options) {
  const supabase = getSupabaseAdmin();
  let created = 0;
  let skipped = 0;

  for (const product of products) {
    const categoryId = resolveCanonicalCategoryId(product.category_slug);

    const partPayload = {
      sku: product.sku,
      slug: product.slug,
      name: product.title,
      description: product.description,
      category_id: categoryId,
      brand: product.brand,
      condition: 'new',
      part_type: 'aftermarket',
      images: product.image ? [product.image] : [],
      specifications: {
        source: 'ladipomarket.com.ng',
        source_url: product.source_url,
        raw_category_slug: product.category_slug,
      },
      key_features: [],
      is_active: true,
      is_universal: false,
    };

    const { data: part, error: partError } = await supabase
      .from('ladipo_parts')
      .upsert(partPayload, { onConflict: 'slug', ignoreDuplicates: false })
      .select('id')
      .single();

    if (partError || !part) {
      skipped += 1;
      continue;
    }

    const fallbackPrice = 500000; // ₦5,000 default when parsing fails
    const inventoryPayload = {
      part_id: part.id,
      price_kobo: Number.isFinite(product.price_kobo) && product.price_kobo > 0 ? product.price_kobo : fallbackPrice,
      stock_qty: 50,
      seller_label: options.sellerLabel,
    };

    const { data: existingInventory, error: existingInventoryError } = await supabase
      .from('ladipo_part_inventory')
      .select('id')
      .eq('part_id', part.id)
      .maybeSingle();

    if (existingInventoryError) {
      skipped += 1;
      continue;
    }

    if (existingInventory?.id) {
      const { error: updateInventoryError } = await supabase
        .from('ladipo_part_inventory')
        .update({
          price_kobo: inventoryPayload.price_kobo,
          stock_qty: inventoryPayload.stock_qty,
          seller_label: inventoryPayload.seller_label,
        })
        .eq('id', existingInventory.id);
      if (updateInventoryError) {
        skipped += 1;
        continue;
      }
    } else {
      const { error: insertInventoryError } = await supabase
        .from('ladipo_part_inventory')
        .insert(inventoryPayload);
      if (insertInventoryError) {
        skipped += 1;
        continue;
      }
    }

    created += 1;
  }

  return { created, skipped };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`[import-ladipo-market] Starting crawl (limit=${options.limit}, perCategoryLimit=${options.perCategoryLimit}, dryRun=${options.dryRun})`);

  const products = await crawlLadipoMarketProducts(options.limit, options.perCategoryLimit);
  if (products.length === 0) {
    throw new Error('No products discovered from LadipoMarket crawl');
  }

  console.log(`[import-ladipo-market] Crawled ${products.length} products`);

  if (options.dryRun) {
    const preview = products.slice(0, 10).map((p) => ({
      title: p.title,
      category_slug: p.category_slug,
      price_kobo: p.price_kobo,
      image: p.image,
    }));
    console.log('[import-ladipo-market] Dry run preview:');
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const result = await syncToDatabase(products, options);
  console.log(`[import-ladipo-market] Import complete. upserted=${result.created}, skipped=${result.skipped}`);
}

main().catch((error) => {
  console.error(`[import-ladipo-market] Fatal error: ${error.message}`);
  process.exit(1);
});
