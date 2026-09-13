/**
 * Vehicle catalog — the referee for every fitment claim.
 *
 * An LLM proposing "this fits a Toyota Cambry 1985" must be caught before the
 * row reaches the database. Everything the extractor produces is checked
 * against this catalog: the make must exist, the model must exist under it,
 * and the year range must overlap that model's real production years.
 *
 * The catalog itself is built by scripts/build-vehicle-catalog.js from NHTSA
 * vPIC plus a hand-maintained Nigerian supplement (vPIC is US-market only, so
 * it has no Hilux and no Hiace — two of the most common vehicles here).
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CATALOG_PATH = join(__dirname, '..', 'data', 'vehicle-catalog.json');

/**
 * Mirrors public.ladipo_fitment_key in migration 076. Any drift between these
 * two means a row we validate here fails to match at query time, so they must
 * stay byte-identical in behaviour.
 */
export function fitmentKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Mirrors public.ladipo_make_key in migration 076. */
export function makeKey(value) {
  const key = fitmentKey(value);
  if (key === 'mercedes' || key === 'benz') return 'mercedesbenz';
  if (key === 'vw') return 'volkswagen';
  return key;
}

let cached = null;

export function loadCatalog({ force = false } = {}) {
  if (cached && !force) return cached;
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(
      `Vehicle catalog missing at ${CATALOG_PATH}. Run: npm run build:vehicle-catalog`
    );
  }
  cached = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

  // Index every alternative label back to its canonical model, so "GLE"
  // resolves to GLE-Class and "Prado" to Land Cruiser Prado. Canonical keys
  // are registered first and never overwritten by a label from another model.
  for (const makeEntry of Object.values(cached.makes)) {
    const index = {};
    for (const [key, model] of Object.entries(makeEntry.models)) index[key] = key;
    for (const [key, model] of Object.entries(makeEntry.models)) {
      for (const label of model.labels || []) {
        const labelKey = fitmentKey(label);
        if (!labelKey || index[labelKey]) continue;
        index[labelKey] = key;
      }
    }
    makeEntry.labelIndex = index;
  }
  return cached;
}

export function resolveMake(make) {
  const catalog = loadCatalog();
  const entry = catalog.makes[makeKey(make)];
  return entry ? entry.name : null;
}

export function resolveModel(make, model) {
  const catalog = loadCatalog();
  const makeEntry = catalog.makes[makeKey(make)];
  if (!makeEntry) return null;
  const key = makeEntry.labelIndex?.[fitmentKey(model)];
  return key ? makeEntry.models[key] : null;
}

/**
 * Garage entries are inconsistent — the same car is saved as "C300", "C Class"
 * or "C-Class" depending on who typed it. Fitment matching is an exact key
 * comparison (see get_ladipo_compatible_part_ids), so a part is written once
 * per label that means the same vehicle.
 *
 * Only equivalent labels are expanded, never sibling trims: C300 expands to
 * C-Class because a C300 *is* a C-Class, but C-Class does not expand to C300.
 */
export function expandModelLabels(make, model) {
  const entry = resolveModel(make, model);
  if (!entry) return [String(model)];
  const labels = new Set([entry.name, ...(entry.labels || [])]);
  return [...labels];
}

const MIN_YEAR = 1980;
const MAX_YEAR = new Date().getFullYear() + 2;
const MAX_SPAN_YEARS = 25;

/**
 * @returns {{ok: boolean, reason?: string, value?: object}}
 */
export function validateFitment({ make, model, year_min: yearMin, year_max: yearMax }) {
  const canonicalMake = resolveMake(make);
  if (!canonicalMake) {
    return { ok: false, reason: `unknown_make:${make}` };
  }

  // A make-only claim is too coarse to be useful under strict publishing —
  // "fits Toyota" would surface a Hilux clutch to a Corolla owner.
  if (!model || !String(model).trim()) {
    return { ok: false, reason: 'missing_model' };
  }

  const modelEntry = resolveModel(canonicalMake, model);
  if (!modelEntry) {
    return { ok: false, reason: `unknown_model:${canonicalMake} ${model}` };
  }

  const min = yearMin == null ? null : Number(yearMin);
  const max = yearMax == null ? null : Number(yearMax);

  for (const [label, year] of [['year_min', min], ['year_max', max]]) {
    if (year == null) continue;
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      return { ok: false, reason: `implausible_${label}:${year}` };
    }
  }

  if (min != null && max != null) {
    if (min > max) return { ok: false, reason: `inverted_year_range:${min}-${max}` };
    if (max - min > MAX_SPAN_YEARS) {
      return { ok: false, reason: `year_span_too_wide:${min}-${max}` };
    }
  }

  // The claimed range has to intersect the years the model actually existed.
  // This is what rejects "Nissan Altima 1985" while still allowing a range
  // that runs slightly past a generation boundary.
  const prodMin = modelEntry.year_min;
  const prodMax = modelEntry.year_max;
  if (min != null && prodMax != null && min > prodMax) {
    return { ok: false, reason: `after_production:${min}>${prodMax}` };
  }
  if (max != null && prodMin != null && max < prodMin) {
    return { ok: false, reason: `before_production:${max}<${prodMin}` };
  }

  return {
    ok: true,
    value: {
      make: canonicalMake,
      model: modelEntry.name,
      year_min: min == null ? null : Math.max(min, prodMin ?? min),
      year_max: max == null ? null : Math.min(max, prodMax ?? max),
    },
  };
}

export function catalogStats() {
  const catalog = loadCatalog();
  const makes = Object.values(catalog.makes);
  return {
    generated_at: catalog.generated_at,
    makes: makes.length,
    models: makes.reduce((sum, m) => sum + Object.keys(m.models).length, 0),
  };
}
