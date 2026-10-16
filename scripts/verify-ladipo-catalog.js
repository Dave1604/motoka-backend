/**
 * Regression gate for the Ladipo catalog.
 *
 *   1. Every published part has either is_universal or at least one
 *      compatibility row — otherwise "Filter by my car" is a lie.
 *   2. Every compatibility model resolves in the vehicle catalog — catches
 *      title-parser leftovers like "Genuine MAF" / "Benz Rear".
 *   3. Coverage report per TARGET_CARS: exact-fitment parts and distinct
 *      categories. Exits 1 if any target is below the minimum.
 *
 *   node scripts/verify-ladipo-catalog.js
 *   node scripts/verify-ladipo-catalog.js --report-only
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { loadCatalog, resolveModel, makeKey } from './lib/vehicleCatalog.js';
import {
  MIN_CATEGORIES,
  MIN_EXACT_PARTS,
  TARGET_CARS,
} from './lib/ladipoTargetCars.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function parseArgs(argv) {
  return {
    reportOnly: argv.includes('--report-only'),
    minParts: MIN_EXACT_PARTS,
    minCategories: MIN_CATEGORIES,
  };
}

async function fetchAll(supabase, table, columns, extra = (q) => q) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = extra(
      supabase.from(table).select(columns).range(from, from + PAGE - 1)
    );
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function reportCoverage(supabase, { minParts, minCategories }) {
  const report = [];
  for (const car of TARGET_CARS) {
    const { data, error } = await supabase.rpc('get_ladipo_compatible_part_ids', {
      p_make: car.make,
      p_model: car.model,
      p_year: car.year,
    });
    if (error) throw new Error(`RPC ${car.make} ${car.model}: ${error.message}`);
    const ids = [...new Set((data || []).map((r) => r.part_id).filter(Boolean))];

    let exact = 0;
    const categories = new Set();
    if (ids.length > 0) {
      const { data: parts, error: partsError } = await supabase
        .from('ladipo_parts')
        .select('id, is_universal, is_active, category_id')
        .in('id', ids)
        .eq('is_active', true);
      if (partsError) throw new Error(partsError.message);
      for (const part of parts || []) {
        if (part.is_universal) continue;
        exact += 1;
        if (part.category_id) categories.add(part.category_id);
      }
    }

    const ok = exact >= minParts && categories.size >= minCategories;
    report.push({
      ...car,
      exact,
      categories: categories.size,
      ok,
    });
  }
  return report;
}

export async function verifyLadipoCatalog(options = {}) {
  const { reportOnly = false, minParts = MIN_EXACT_PARTS, minCategories = MIN_CATEGORIES } = options;
  loadCatalog();
  const supabase = getSupabaseAdmin();
  const failures = [];

  const parts = await fetchAll(
    supabase,
    'ladipo_parts',
    'id, slug, name, is_active, is_universal',
    (q) => q.eq('is_active', true)
  );
  const compat = await fetchAll(
    supabase,
    'ladipo_part_compatibility',
    'part_id, make, model, year_min, year_max'
  );

  const compatByPart = new Map();
  for (const row of compat) {
    if (!compatByPart.has(row.part_id)) compatByPart.set(row.part_id, []);
    compatByPart.get(row.part_id).push(row);
  }

  let orphanPublished = 0;
  for (const part of parts) {
    if (part.is_universal) continue;
    const rows = compatByPart.get(part.id) || [];
    if (rows.length === 0) {
      orphanPublished += 1;
      if (orphanPublished <= 8) {
        failures.push(`published_without_fitment:${part.slug}`);
      }
    }
  }

  let offCatalog = 0;
  const seenOff = new Set();
  for (const row of compat) {
    if (!row.model) {
      offCatalog += 1;
      continue;
    }
    if (!resolveModel(row.make, row.model)) {
      offCatalog += 1;
      const key = `${makeKey(row.make)}|${row.model}`;
      if (!seenOff.has(key) && seenOff.size < 12) {
        seenOff.add(key);
        failures.push(`off_catalog_model:${row.make} ${row.model}`);
      }
    }
  }

  const coverage = await reportCoverage(supabase, { minParts, minCategories });
  const short = coverage.filter((row) => !row.ok);

  console.log(`[verify] active parts          ${parts.length}`);
  console.log(`[verify] compatibility rows    ${compat.length}`);
  console.log(`[verify] published w/o fitment ${orphanPublished}`);
  console.log(`[verify] off-catalog models    ${offCatalog}`);
  console.log('[verify] coverage:');
  for (const row of coverage) {
    const mark = row.ok ? 'ok' : 'LOW';
    console.log(
      `  [${mark}] ${row.make} ${row.model} ${row.year}  exact=${row.exact}  categories=${row.categories}`
    );
  }

  if (reportOnly) {
    return { ok: true, coverage, orphanPublished, offCatalog };
  }

  if (orphanPublished > 0) failures.push(`published_without_fitment_count:${orphanPublished}`);
  if (offCatalog > 0) failures.push(`off_catalog_count:${offCatalog}`);
  for (const row of short) {
    failures.push(`coverage:${row.make} ${row.model} exact=${row.exact} cats=${row.categories}`);
  }

  if (failures.length > 0) {
    console.error(`[verify] FAILED (${failures.length})`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    const err = new Error(`Catalog verification failed (${failures.length} issues)`);
    err.failures = failures;
    throw err;
  }

  console.log('[verify] passed');
  return { ok: true, coverage, orphanPublished, offCatalog };
}

const invokedDirectly = process.argv[1]?.endsWith('verify-ladipo-catalog.js');
if (invokedDirectly) {
  verifyLadipoCatalog(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`[verify] Fatal: ${err.message}`);
    process.exit(1);
  });
}
