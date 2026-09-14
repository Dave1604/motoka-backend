/**
 * Rewrite of the title-parser backfill.
 *
 * Existing catalog rows that still have no compatibility are sent through
 * the same extract → verify → upsert path as a fresh scrape, so a leftover
 * "Genuine MAF" model never gets written.
 *
 *   node scripts/backfill-ladipo-compatibility.js --dry-run --limit 50
 *   node scripts/backfill-ladipo-compatibility.js --limit 500
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { ID_TO_SLUG } from './lib/ladipoCanonicalCategories.js';
import { runCatalogPipeline } from './lib/ladipoCatalogPipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const options = { dryRun: false, limit: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10);
      i += 1;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseAdmin();

  const { data: parts, error } = await supabase
    .from('ladipo_parts')
    .select('id, slug, name, description, brand, category_id, images, specifications, is_universal')
    .eq('is_active', true)
    .limit(options.limit);
  if (error) throw new Error(error.message);

  const ids = (parts || []).map((p) => p.id);
  const hasCompat = new Set();
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: rows, error: compatError } = await supabase
      .from('ladipo_part_compatibility')
      .select('part_id')
      .in('part_id', slice);
    if (compatError) throw new Error(compatError.message);
    for (const row of rows || []) hasCompat.add(row.part_id);
  }

  const pending = (parts || []).filter((p) => !p.is_universal && !hasCompat.has(p.id));
  console.log(`[backfill] ${parts?.length || 0} parts scanned, ${pending.length} missing fitment`);

  const products = pending.map((part) => ({
    slug: part.slug,
    title: part.name,
    description: part.description,
    brand: part.brand,
    category_slug: ID_TO_SLUG[part.category_id] || null,
    image: Array.isArray(part.images) ? part.images[0] : null,
    source: part.specifications?.source || 'existing',
    source_url: part.specifications?.source_url || null,
    price_kobo: null,
  }));

  if (products.length === 0) {
    console.log('[backfill] nothing to do');
    return;
  }

  await runCatalogPipeline(products, {
    dryRun: options.dryRun,
    rehostImages: false,
    resume: false,
    sellerLabel: 'Motoka',
  });
}

main().catch((err) => {
  console.error(`[backfill] Fatal: ${err.message}`);
  process.exit(1);
});
