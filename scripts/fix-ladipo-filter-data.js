/**
 * One-shot Ladipo catalog hygiene:
 * 1. Insert Transmission & Drivetrain category (migration 073)
 * 2. Remap gearboxes / drivetrain out of Gear Oil & ATF
 * 3. Delete compatibility rows that conflict with the product title/brand
 *
 *   node scripts/fix-ladipo-filter-data.js --dry-run
 *   node scripts/fix-ladipo-filter-data.js
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { CANONICAL } from './lib/ladipoCanonicalCategories.js';
import { compatibilityConflictsWithTitle } from '../src/utils/ladipoCarBrand.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const TRANSMISSION = {
  id: CANONICAL.TRANSMISSION_DRIVETRAIN,
  name: 'Transmission & Drivetrain',
  slug: 'spare-parts-transmission-drivetrain',
  parent_id: CANONICAL.SPARE_PARTS,
  sort_order: 6,
};

/** raw_category_slug → correct Motoka category */
const RAW_SLUG_REMAP = {
  'gear-boxes': CANONICAL.TRANSMISSION_DRIVETRAIN,
  gears: CANONICAL.TRANSMISSION_DRIVETRAIN,
  'gear-pumps': CANONICAL.TRANSMISSION_DRIVETRAIN,
  'gear-filters': CANONICAL.OIL_FILTER,
  'spare-parts-drivetrain': CANONICAL.TRANSMISSION_DRIVETRAIN,
  'spare-parts-transmission': CANONICAL.TRANSMISSION_DRIVETRAIN,
  'oil-pumps': CANONICAL.ENGINE_PARTS,
};

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

async function ensureTransmissionCategory(supabase, dryRun) {
  const { data: existing, error } = await supabase
    .from('ladipo_categories')
    .select('id')
    .eq('slug', TRANSMISSION.slug)
    .maybeSingle();
  if (error) throw error;
  if (existing?.id) {
    console.log(`[fix] Transmission category already present (${existing.id})`);
    return;
  }
  if (dryRun) {
    console.log('[fix] Dry run — would insert Transmission & Drivetrain category');
    return;
  }
  const { error: insertError } = await supabase.from('ladipo_categories').insert(TRANSMISSION);
  if (insertError) throw insertError;
  console.log('[fix] Inserted Transmission & Drivetrain category');
}

async function remapMisfiledCategories(supabase, dryRun) {
  const { data: parts, error } = await supabase
    .from('ladipo_parts')
    .select('id, name, category_id, specifications')
    .limit(5000);
  if (error) throw error;

  const updates = [];
  for (const part of parts || []) {
    const raw = part.specifications?.raw_category_slug;
    if (!raw) continue;
    const leaf = String(raw).split('/').pop();
    const target = RAW_SLUG_REMAP[leaf] || RAW_SLUG_REMAP[raw];
    if (!target || part.category_id === target) continue;
    updates.push({ id: part.id, name: part.name, from: part.category_id, to: target, raw });
  }

  // Also move anything currently in Gear Oil whose name is clearly a gearbox / axle.
  const gearOilId = CANONICAL.GEAR_OIL;
  for (const part of parts || []) {
    if (part.category_id !== gearOilId) continue;
    if (updates.some((u) => u.id === part.id)) continue;
    const name = String(part.name || '').toLowerCase();
    const mechanical = /\b(gear\s*box|gearbox|cv\s*axle|axle\/\s*shaft|transmission\s*assy|driveshaft)\b/.test(name);
    const fluid = /\b(atf|gear\s*oil|transmission\s*fluid|fluid)\b/.test(name);
    if (mechanical && !fluid) {
      updates.push({
        id: part.id,
        name: part.name,
        from: gearOilId,
        to: CANONICAL.TRANSMISSION_DRIVETRAIN,
        raw: 'name-heuristic',
      });
    }
  }

  console.log(`[fix] Category remaps needed: ${updates.length}`);
  if (dryRun) {
    console.log(JSON.stringify(updates.slice(0, 15), null, 2));
    return updates.length;
  }

  let fixed = 0;
  for (const row of updates) {
    const { error: updErr } = await supabase
      .from('ladipo_parts')
      .update({ category_id: row.to })
      .eq('id', row.id);
    if (updErr) {
      console.warn(`  ! failed ${row.id}: ${updErr.message}`);
      continue;
    }
    fixed += 1;
  }
  console.log(`[fix] Remapped ${fixed} products`);
  return fixed;
}

async function deleteConflictingCompatibility(supabase, dryRun) {
  const { data: rows, error } = await supabase
    .from('ladipo_part_compatibility')
    .select('id, make, part:ladipo_parts(id, name, brand)')
    .limit(5000);
  if (error) throw error;

  const badIds = [];
  for (const row of rows || []) {
    if (compatibilityConflictsWithTitle(row.make, row.part?.name, row.part?.brand)) {
      badIds.push(row.id);
    }
  }

  console.log(`[fix] Conflicting compatibility rows: ${badIds.length}`);
  if (dryRun) return badIds.length;
  if (!badIds.length) return 0;

  let deleted = 0;
  for (let i = 0; i < badIds.length; i += 100) {
    const batch = badIds.slice(i, i + 100);
    const { error: delErr } = await supabase
      .from('ladipo_part_compatibility')
      .delete()
      .in('id', batch);
    if (delErr) throw delErr;
    deleted += batch.length;
  }
  console.log(`[fix] Deleted ${deleted} conflicting compatibility rows`);
  return deleted;
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseAdmin();
  console.log(`[fix] Starting Ladipo filter-data fix (dryRun=${dryRun})`);

  await ensureTransmissionCategory(supabase, dryRun);
  await remapMisfiledCategories(supabase, dryRun);
  await deleteConflictingCompatibility(supabase, dryRun);

  const gearOilId = CANONICAL.GEAR_OIL;
  const { count: gearOilLeft } = await supabase
    .from('ladipo_parts')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', gearOilId);
  const { count: gearBoxInOil } = await supabase
    .from('ladipo_parts')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', gearOilId)
    .ilike('name', '%gear box%');
  const { data: bmwCompat } = await supabase.rpc('get_ladipo_compatible_part_ids', {
    p_make: 'BMW',
    p_model: null,
    p_year: null,
  });
  console.log(JSON.stringify({
    gearOilParts: gearOilLeft,
    gearBoxStillInGearOil: gearBoxInOil,
    bmwCompatParts: (bmwCompat || []).length,
  }, null, 2));
  console.log('[fix] done');
}

main().catch((error) => {
  console.error(`[fix] Fatal: ${error.message}`);
  process.exit(1);
});
