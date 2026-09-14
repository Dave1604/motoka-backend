/**
 * Admin-set merchandising flags + missing category images.
 *
 * Rails on the Ladipo landing page are never inferred from sales — they are
 * explicit flags. After a catalog seed this picks a deterministic, image-
 * bearing subset so GET /ladipo/sections is not empty.
 *
 *   node scripts/merchandize-ladipo.js
 *   node scripts/merchandize-ladipo.js --dry-run
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { CANONICAL } from './lib/ladipoCanonicalCategories.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const FLAG_BUDGETS = {
  is_essential: { limit: 16, categories: [CANONICAL.OIL_FILTER, CANONICAL.AIR_FILTER, CANONICAL.SPARK_PLUGS, CANONICAL.ENGINE_OIL, CANONICAL.FUEL_FILTER] },
  is_must_have: { limit: 16, categories: [CANONICAL.BRAKE_WHEEL_HUB, CANONICAL.CAR_BATTERIES, CANONICAL.CAR_TYRES, CANONICAL.SUSPENSION] },
  is_featured: { limit: 12, categories: null },
  is_bestseller: { limit: 12, categories: [CANONICAL.BRAKE_WHEEL_HUB, CANONICAL.ENGINE_PARTS, CANONICAL.OIL_FILTER, CANONICAL.CAR_BATTERIES] },
  is_deal: { limit: 12, categories: [CANONICAL.ENGINE_OIL, CANONICAL.INTERIOR, CANONICAL.SPARK_PLUGS, CANONICAL.BULBS_LIGHTING] },
};

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

function hasImage(part) {
  return Array.isArray(part.images) && part.images.some((u) => typeof u === 'string' && u.startsWith('https://'));
}

function pick(parts, { limit, categories }, used) {
  const pool = parts.filter((p) => {
    if (used.has(p.id)) return false;
    if (!hasImage(p)) return false;
    if (categories && !categories.includes(p.category_id)) return false;
    return true;
  });
  return pool.slice(0, limit);
}

export async function merchandizeLadipo({ dryRun = false } = {}) {
  const supabase = getSupabaseAdmin();

  const { data: parts, error } = await supabase
    .from('ladipo_parts')
    .select('id, images, category_id, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Failed reading parts: ${error.message}`);

  const catalog = parts || [];
  const used = new Set();
  const assignments = {};

  for (const [flag, rule] of Object.entries(FLAG_BUDGETS)) {
    const chosen = pick(catalog, rule, used);
    assignments[flag] = chosen.map((p) => p.id);
    for (const p of chosen) used.add(p.id);
  }

  console.log('[merchandize] picks', Object.fromEntries(
    Object.entries(assignments).map(([flag, ids]) => [flag, ids.length])
  ));

  if (dryRun) return assignments;

  // Clear existing flags on active parts so a re-run does not accumulate.
  const { error: clearError } = await supabase
    .from('ladipo_parts')
    .update({
      is_essential: false,
      is_must_have: false,
      is_featured: false,
      is_bestseller: false,
      is_deal: false,
    })
    .eq('is_active', true);
  if (clearError) throw new Error(`Failed clearing flags: ${clearError.message}`);

  for (const [flag, ids] of Object.entries(assignments)) {
    if (ids.length === 0) continue;
    const { error: flagError } = await supabase
      .from('ladipo_parts')
      .update({ [flag]: true })
      .in('id', ids);
    if (flagError) throw new Error(`Failed setting ${flag}: ${flagError.message}`);
  }

  const { data: categories, error: catError } = await supabase
    .from('ladipo_categories')
    .select('id, slug, image_url');
  if (catError) throw new Error(`Failed reading categories: ${catError.message}`);

  let filled = 0;
  for (const category of categories || []) {
    if (category.image_url) continue;
    const donor = catalog.find((p) => p.category_id === category.id && hasImage(p));
    if (!donor) continue;
    const imageUrl = donor.images.find((u) => typeof u === 'string' && u.startsWith('https://'));
    const { error: imgError } = await supabase
      .from('ladipo_categories')
      .update({ image_url: imageUrl })
      .eq('id', category.id);
    if (imgError) {
      console.warn(`[merchandize] category image ${category.slug}: ${imgError.message}`);
      continue;
    }
    filled += 1;
  }
  console.log(`[merchandize] filled ${filled} category image_url values`);
  return assignments;
}

const invokedDirectly = process.argv[1]?.endsWith('merchandize-ladipo.js');
if (invokedDirectly) {
  merchandizeLadipo(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`[merchandize] Fatal: ${err.message}`);
    process.exit(1);
  });
}
