/**
 * Scrape → extract → verify → upsert.
 *
 * The extractor proposes, the verifier admits, this module writes. Products
 * that fail verification are still inserted (is_active = false) so a later
 * prompt or a RockAuto pass can rescue them without re-crawling.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../../src/config/supabase.js';
import { uploadToCloudinary } from '../../src/services/fileUpload.service.js';
import { CANONICAL, SLUG_TO_ID } from './ladipoCanonicalCategories.js';
import { extractFitment } from './ladipoAiFitment.js';
import { summarize, verifyExtraction, enrichExtractionWithOem } from './ladipoFitmentVerify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_PATH = join(__dirname, '..', 'data', 'pipeline-checkpoint.json');

const FALLBACK_PRICE_KOBO = 500_000;
const STOCK_QTY = 50;

const AUTOFCTOR_CATEGORY_TO_CANONICAL = {
  'accessories-exterior-accessories': CANONICAL.EXTERIOR,
  'accessories-interior-accessories': CANONICAL.INTERIOR,
  batteries: CANONICAL.CAR_BATTERIES,
  'car-care-tools-car-care': CANONICAL.INTERIOR,
  'car-care-tools-tools-gadget-safety-products': CANONICAL.INTERIOR,
  'lubricants-fluids-additives': CANONICAL.ENGINE_OIL,
  'lubricants-fluids-coolants-appearance-products': CANONICAL.BRAKE_FLUID_COOLANT,
  'lubricants-fluids-engine-oil': CANONICAL.ENGINE_OIL,
  'lubricants-fluids-grease-gum': CANONICAL.ENGINE_OIL,
  'lubricants-fluids-steering-brake-fluid': CANONICAL.BRAKE_FLUID_COOLANT,
  'lubricants-fluids-transmission-fluid': CANONICAL.GEAR_OIL,
  'servicing-parts-air-filters': CANONICAL.AIR_FILTER,
  'servicing-parts-oil-filter': CANONICAL.OIL_FILTER,
  'servicing-parts-spark-plugs': CANONICAL.SPARK_PLUGS,
  'spare-parts-air-intake': CANONICAL.ENGINE_PARTS,
  'spare-parts-body-light-parts': CANONICAL.BULBS_LIGHTING,
  'spare-parts-brake-wheel-hub-bearings': CANONICAL.BRAKE_WHEEL_HUB,
  'spare-parts-cooling-heating-system': CANONICAL.ENGINE_PARTS,
  'spare-parts-drivetrain': CANONICAL.TRANSMISSION_DRIVETRAIN,
  'spare-parts-electrical': CANONICAL.ALTERNATORS,
  'spare-parts-engine-parts': CANONICAL.ENGINE_PARTS,
  'spare-parts-exhaust-emission': CANONICAL.EXHAUST,
  'spare-parts-fuel-system-fuel-injection': CANONICAL.ENGINE_PARTS,
  'spare-parts-steering-parts': CANONICAL.STEERING_PARTS,
  'spare-parts-suspension-parts': CANONICAL.SUSPENSION,
  'spare-parts-transmission': CANONICAL.TRANSMISSION_DRIVETRAIN,
  tyres: CANONICAL.CAR_TYRES,
};

function resolveCategoryId(extraction, product) {
  const aiSlug = extraction?.category_slug;
  if (aiSlug && SLUG_TO_ID[aiSlug]) return SLUG_TO_ID[aiSlug];
  return AUTOFCTOR_CATEGORY_TO_CANONICAL[product.category_slug] || CANONICAL.SPARE_PARTS;
}

function isUsableImage(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.trim().toLowerCase();
  if (!lower.startsWith('https://')) return false;
  if (lower.includes('heart.png') || lower.includes('placeholder') || lower.includes('no-image')) {
    return false;
  }
  return true;
}

function skuFor(product) {
  const hash = createHash('sha1').update(product.slug).digest('hex').slice(0, 8).toUpperCase();
  return `AF-${String(product.slug).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 16)}-${hash}`;
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_PATH)) return { slugs: [] };
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch {
    return { slugs: [] };
  }
}

function saveCheckpoint(state) {
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true });
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
}

/**
 * Download a remote product image and put it on Cloudinary. Falls back to the
 * source URL if Cloudinary is unconfigured or the host is unreachable, so a
 * missing CDN never drops a product from the catalog.
 */
export async function rehostImage(url) {
  if (!isUsableImage(url)) return [];
  if (url.includes('res.cloudinary.com')) return [url];

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'MotokaLadipoImporter/1.0 (+https://motoka.ng)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [url];
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 64) return [url];
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const cloudUrl = await uploadToCloudinary(buffer, `product${ext}`, contentType);
    return [cloudUrl];
  } catch (err) {
    console.warn(`[pipeline] Cloudinary rehost failed for ${url}: ${err.message}`);
    return [url];
  }
}

export function printAccuracyReport(verdicts, label = 'pipeline') {
  const summary = summarize(verdicts);
  const publishRate = summary.total
    ? ((summary.published + summary.universal) / summary.total * 100).toFixed(1)
    : '0.0';
  console.log(`\n[${label}] accuracy report`);
  console.log(`[${label}]   total        ${summary.total}`);
  console.log(`[${label}]   published    ${summary.published}  (verified fitment)`);
  console.log(`[${label}]   universal    ${summary.universal}`);
  console.log(`[${label}]   staged       ${summary.staged}  (is_active=false)`);
  console.log(`[${label}]   fitment rows ${summary.fitment_rows}`);
  console.log(`[${label}]   admit rate   ${publishRate}%`);
  const reasons = Object.entries(summary.rejections).sort((a, b) => b[1] - a[1]);
  if (reasons.length) {
    console.log(`[${label}]   rejections:`);
    for (const [reason, count] of reasons) {
      console.log(`[${label}]     ${reason.padEnd(28)} ${count}`);
    }
  }
  return summary;
}

async function replaceFitment(supabase, partId, rows) {
  const { error: deleteError } = await supabase
    .from('ladipo_part_compatibility')
    .delete()
    .eq('part_id', partId)
    .or('source.in.(ai,oem),source.is.null');
  if (deleteError) throw new Error(`Failed clearing old fitment: ${deleteError.message}`);

  if (rows.length === 0) return;
  const payload = rows.map((row) => ({
    part_id: partId,
    make: row.make,
    model: row.model,
    year_min: row.year_min,
    year_max: row.year_max,
    source: row.source || 'ai',
    confidence: row.confidence ?? null,
    verified_by: row.verified_by || 'vehicle-catalog',
  }));
  const { error: insertError } = await supabase
    .from('ladipo_part_compatibility')
    .upsert(payload, { ignoreDuplicates: true });
  if (insertError) throw new Error(`Failed inserting fitment: ${insertError.message}`);
}

async function upsertInventory(supabase, partId, priceKobo, sellerLabel) {
  const { data: existing, error: readError } = await supabase
    .from('ladipo_part_inventory')
    .select('id, price_kobo')
    .eq('part_id', partId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const nextPrice = Number.isFinite(priceKobo) && priceKobo > 0 ? priceKobo : FALLBACK_PRICE_KOBO;
  if (existing?.id) {
    const { error } = await supabase
      .from('ladipo_part_inventory')
      .update({
        price_kobo: Number.isFinite(priceKobo) && priceKobo > 0 ? nextPrice : (existing.price_kobo || nextPrice),
        stock_qty: STOCK_QTY,
        seller_label: sellerLabel,
      })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from('ladipo_part_inventory').insert({
    part_id: partId,
    price_kobo: nextPrice,
    stock_qty: STOCK_QTY,
    seller_label: sellerLabel,
  });
  if (error) throw new Error(error.message);
}

async function upsertOne(supabase, product, extraction, verdict, options) {
  const categoryId = resolveCategoryId(extraction, product);
  const { data: existing } = await supabase
    .from('ladipo_parts')
    .select('id, sku, images, specifications')
    .eq('slug', product.slug)
    .maybeSingle();

  let images = Array.isArray(existing?.images) ? existing.images.filter(isUsableImage) : [];
  const alreadyCloudinary = images.some((u) => String(u).includes('res.cloudinary.com'));
  if (options.rehostImages && product.image && !alreadyCloudinary) {
    images = await rehostImage(product.image);
  } else if (images.length === 0 && isUsableImage(product.image)) {
    images = [product.image];
  }

  const existingSpecs = existing?.specifications && typeof existing.specifications === 'object'
    ? existing.specifications
    : {};

  const isActive = verdict.status === 'published' || verdict.status === 'universal';
  const partPayload = {
    sku: existing?.sku || skuFor(product),
    slug: product.slug,
    name: extraction?.normalized_name || product.title,
    description: product.description || extraction?.normalized_name || product.title,
    category_id: categoryId,
    brand: extraction?.brand || product.brand,
    condition: extraction?.condition || 'new',
    part_type: extraction?.part_type || 'aftermarket',
    images,
    specifications: {
      ...existingSpecs,
      source: product.source || 'autofactorng.com',
      source_url: product.source_url || null,
      raw_category_slug: product.category_slug,
      part_number: verdict.part_number || extraction?.part_number || existingSpecs.part_number || null,
      fitment_status: verdict.status,
      fitment_reason: verdict.reason,
      ai_reasoning: extraction?.reasoning || null,
    },
    key_features: [],
    is_active: isActive,
    is_universal: verdict.status === 'universal',
  };

  const { data: part, error: partError } = await supabase
    .from('ladipo_parts')
    .upsert(partPayload, { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single();
  if (partError || !part) throw new Error(partError?.message || 'part upsert returned no row');

  await upsertInventory(supabase, part.id, product.price_kobo, options.sellerLabel);
  await replaceFitment(supabase, part.id, verdict.fitment);
  return { id: part.id, status: verdict.status };
}

/**
 * @param {Array<object>} products  scraped listings (slug, title, description, ...)
 * @param {{
 *   dryRun?: boolean,
 *   rehostImages?: boolean,
 *   sellerLabel?: string,
 *   resume?: boolean,
 *   useCache?: boolean,
 *   batchSize?: number,
 * }} options
 */
export async function runCatalogPipeline(products, options = {}) {
  const {
    dryRun = false,
    rehostImages = !dryRun,
    sellerLabel = 'Motoka',
    resume = true,
    useCache = true,
    batchSize,
  } = options;

  const checkpoint = resume ? loadCheckpoint() : { slugs: [] };
  const done = new Set(checkpoint.slugs || []);
  const pending = resume ? products.filter((p) => !done.has(p.slug)) : products;

  console.log(
    `[pipeline] ${products.length} crawled, ${done.size} checkpointed, ${pending.length} to process`
  );

  const extractions = await extractFitment(pending, {
    useCache,
    batchSize,
    onProgress: (event) => {
      if (event.phase === 'start') {
        console.log(`[pipeline] extract: ${event.cached} cached, ${event.pending} to send`);
      } else if (event.phase === 'batch') {
        if (event.error) {
          console.warn(`[pipeline] extract batch failed at ${event.index}: ${event.error}`);
        } else {
          console.log(`[pipeline] extract ${event.done}/${event.pending}`);
        }
      }
    },
  });

  const verdicts = [];
  const work = [];
  for (const product of pending) {
    const extraction = enrichExtractionWithOem(product, extractions.get(product.slug));
    const verdict = verifyExtraction(extraction, product);
    verdicts.push(verdict);
    work.push({ product, extraction, verdict });
  }

  printAccuracyReport(verdicts);

  if (dryRun) {
    const preview = work.slice(0, 12).map(({ product, extraction, verdict }) => ({
      title: product.title,
      normalized: extraction?.normalized_name,
      status: verdict.status,
      reason: verdict.reason,
      fitment: verdict.fitment.slice(0, 3).map((f) => `${f.make} ${f.model} ${f.year_min || '?'}-${f.year_max || '?'}`),
      rejections: verdict.rejections.slice(0, 3),
    }));
    console.log('[pipeline] Dry-run preview:');
    console.log(JSON.stringify(preview, null, 2));
    return { verdicts, upserted: 0, skipped: 0, dryRun: true };
  }

  const supabase = getSupabaseAdmin();
  let upserted = 0;
  let skipped = 0;

  for (const item of work) {
    try {
      await upsertOne(supabase, item.product, item.extraction, item.verdict, {
        rehostImages,
        sellerLabel,
      });
      done.add(item.product.slug);
      upserted += 1;
      if (upserted % 25 === 0) {
        saveCheckpoint({ slugs: [...done], updated_at: new Date().toISOString() });
        console.log(`[pipeline] upserted ${upserted}/${work.length}`);
      }
    } catch (err) {
      skipped += 1;
      console.warn(`[pipeline] skip ${item.product.slug}: ${err.message}`);
    }
  }

  saveCheckpoint({ slugs: [...done], updated_at: new Date().toISOString() });
  console.log(`[pipeline] upsert complete. upserted=${upserted} skipped=${skipped}`);
  return { verdicts, upserted, skipped, dryRun: false };
}
