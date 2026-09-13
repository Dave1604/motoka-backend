/**
 * Verification pass — the referee between the LLM and the database.
 *
 * The extractor is optimised for recall, so this module is where precision is
 * bought back. Three independent checks, all of which must pass before a
 * fitment row is written:
 *
 *   1. Vehicle catalog  the make and model must exist and the years must
 *                       overlap the model's real production run.
 *   2. OEM cross-check  where a part number decodes to a manufacturer with
 *                       confidence, the claim must not contradict it.
 *   3. Plausibility     bounded, ordered year ranges.
 *
 * Anything that fails is not deleted — the product is staged with
 * is_active = false, so a better prompt or a RockAuto pass can rescue it.
 */
import {
  validateFitment,
  expandModelLabels,
  makeKey,
  fitmentKey,
} from './vehicleCatalog.js';

// ---------------------------------------------------------------------------
// OEM part numbers
// ---------------------------------------------------------------------------

/**
 * Mercedes encodes the chassis in the three digits after the A. This is the
 * strongest single signal in the Autofactor data, where titles like
 * "Rear Wiper Blade A1678204903" name no model at all.
 */
const MERCEDES_CHASSIS = {
  167: { model: 'GLE-Class', year_min: 2019, year_max: 2027 },
  166: { model: 'M-Class', year_min: 2012, year_max: 2019 },
  164: { model: 'M-Class', year_min: 2005, year_max: 2011 },
  204: { model: 'C-Class', year_min: 2008, year_max: 2014 },
  205: { model: 'C-Class', year_min: 2015, year_max: 2021 },
  206: { model: 'C-Class', year_min: 2022, year_max: 2027 },
  203: { model: 'C-Class', year_min: 2001, year_max: 2007 },
  211: { model: 'E-Class', year_min: 2003, year_max: 2009 },
  212: { model: 'E-Class', year_min: 2010, year_max: 2016 },
  213: { model: 'E-Class', year_min: 2017, year_max: 2023 },
  221: { model: 'S-Class', year_min: 2006, year_max: 2013 },
  222: { model: 'S-Class', year_min: 2014, year_max: 2020 },
  463: { model: 'G-Class', year_min: 1995, year_max: 2027 },
  156: { model: 'GLA-Class', year_min: 2014, year_max: 2020 },
  253: { model: 'GLC-Class', year_min: 2016, year_max: 2027 },
  292: { model: 'GLE-Class', year_min: 2016, year_max: 2019 },
};

/**
 * Only patterns that identify a manufacturer unambiguously earn a veto.
 * A Toyota-style 5+5 is deliberately absent: Hyundai and Kia use the same
 * shape, so treating it as evidence would reject correct Hyundai fitment.
 */
const OEM_PATTERNS = [
  { make: 'Mercedes-Benz', re: /^A\d{10}$/i, chassis: (s) => Number(s.slice(1, 4)) },
  { make: 'Land Rover', re: /^LR\d{6}$/i },
  { make: 'Honda', re: /^\d{5}[A-Z0-9]{3}[A-Z]{1}[A-Z0-9]{2}$/i, weak: true },
  { make: 'Nissan', re: /^\d{5}[0-9][A-Z]{2}\d[A-Z]$/i, weak: true },
];

/** Pulls candidate part numbers out of free text. */
export function extractPartNumbers(text) {
  if (!text) return [];
  const found = new Set();
  const normalized = String(text).toUpperCase();
  // Tokens of 6+ chars mixing digits with letters/dashes are the shape of a
  // part number; plain words and plain numbers are not.
  const tokens = normalized.match(/[A-Z0-9][A-Z0-9-]{4,}[A-Z0-9]/g) || [];
  for (const token of tokens) {
    const compact = token.replace(/-/g, '');
    if (compact.length < 6 || compact.length > 17) continue;
    if (!/\d/.test(compact)) continue;
    if (/^\d+$/.test(compact) && compact.length < 9) continue; // years, sizes, quantities
    found.add(compact);
  }
  return [...found];
}

/**
 * @returns {{make: string, model?: string, year_min?: number, year_max?: number, weak: boolean}|null}
 */
export function decodePartNumber(partNumber) {
  const compact = String(partNumber || '').replace(/[\s-]/g, '').toUpperCase();
  for (const pattern of OEM_PATTERNS) {
    if (!pattern.re.test(compact)) continue;
    const decoded = { make: pattern.make, weak: Boolean(pattern.weak) };
    if (pattern.chassis) {
      const chassis = MERCEDES_CHASSIS[pattern.chassis(compact)];
      if (chassis) Object.assign(decoded, chassis);
    }
    return decoded;
  }
  return null;
}

/** Best decode across every part number visible in the text. */
export function decodeFromText(text) {
  for (const candidate of extractPartNumbers(text)) {
    const decoded = decodePartNumber(candidate);
    if (decoded && !decoded.weak) return { ...decoded, part_number: candidate };
  }
  for (const candidate of extractPartNumbers(text)) {
    const decoded = decodePartNumber(candidate);
    if (decoded) return { ...decoded, part_number: candidate };
  }
  return null;
}

/**
 * When the LLM times out or abstains, a confidently decoded OEM number is
 * still enough to propose a model-level fitment. The verifier still has to
 * admit it — this only fills the proposal.
 */
export function enrichExtractionWithOem(product, extraction) {
  const alreadyHasFitment = Array.isArray(extraction?.fitment) && extraction.fitment.length > 0
    && extraction.abstain !== true;
  if (alreadyHasFitment) return extraction;

  const decoded = decodeFromText(
    [product?.title, product?.description, extraction?.normalized_name, extraction?.part_number]
      .filter(Boolean)
      .join(' ')
  );
  if (!decoded?.model) return extraction;

  return {
    ...(extraction || {}),
    normalized_name: extraction?.normalized_name || product?.title || null,
    brand: extraction?.brand || decoded.make,
    part_number: decoded.part_number,
    category_slug: extraction?.category_slug || product?.category_slug || null,
    condition: extraction?.condition || 'new',
    part_type: extraction?.part_type || 'oem',
    is_universal: false,
    fitment: [{
      make: decoded.make,
      model: decoded.model,
      year_min: decoded.year_min ?? null,
      year_max: decoded.year_max ?? null,
    }],
    confidence: decoded.weak ? 0.4 : 0.78,
    abstain: false,
    reasoning: `OEM part number ${decoded.part_number} decoded to ${decoded.make} ${decoded.model}`,
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const UNIVERSAL_CATEGORY_PREFIXES = [
  'lubricants-fluids',
  'car-accessories-interior',
];

const MIN_CONFIDENCE = 0.45;

/**
 * @param {object} extraction  a single result from extractFitment
 * @param {object} product     the scraped product it came from
 * @returns {{
 *   status: 'published'|'universal'|'staged',
 *   fitment: Array<object>,
 *   rejections: Array<string>,
 *   reason: string,
 *   part_number: string|null
 * }}
 */
export function verifyExtraction(extraction, product = {}) {
  const rejections = [];
  const sourceText = [product.title, extraction?.normalized_name, product.description]
    .filter(Boolean)
    .join(' ');
  const decoded = decodeFromText(sourceText);
  const partNumber = extraction?.part_number || decoded?.part_number || null;

  if (!extraction) {
    return { status: 'staged', fitment: [], rejections: ['no_extraction'], reason: 'no_extraction', part_number: null };
  }

  // Universal goods never carry fitment rows, and the category has to back the
  // claim up — the model calling a brake disc "universal" is not enough.
  if (extraction.is_universal) {
    const slug = extraction.category_slug || product.category_slug || '';
    const plausible = UNIVERSAL_CATEGORY_PREFIXES.some((p) => slug.startsWith(p));
    if (plausible) {
      return { status: 'universal', fitment: [], rejections: [], reason: 'universal_category', part_number: partNumber };
    }
    rejections.push(`universal_claim_rejected:${slug || 'no_category'}`);
  }

  if (extraction.abstain) {
    return {
      status: 'staged',
      fitment: [],
      rejections: [...rejections, 'model_abstained'],
      reason: extraction.reasoning || 'model_abstained',
      part_number: partNumber,
    };
  }

  const confidence = Number(extraction.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
    return {
      status: 'staged',
      fitment: [],
      rejections: [...rejections, `low_confidence:${extraction.confidence}`],
      reason: 'low_confidence',
      part_number: partNumber,
    };
  }

  const claims = Array.isArray(extraction.fitment) ? extraction.fitment : [];
  if (claims.length === 0) {
    return {
      status: 'staged',
      fitment: [],
      rejections: [...rejections, 'no_fitment_claimed'],
      reason: 'no_fitment_claimed',
      part_number: partNumber,
    };
  }

  const rows = [];
  const seen = new Set();

  for (const claim of claims) {
    // Check 1 — the vehicle must be real.
    const validated = validateFitment(claim);
    if (!validated.ok) {
      rejections.push(validated.reason);
      continue;
    }
    const { make, model, year_min: yearMin, year_max: yearMax } = validated.value;

    // Check 2 — a confidently decoded part number vetoes a contradicting make.
    // Weak decodes are ignored: they would reject more good rows than bad.
    if (decoded && !decoded.weak && makeKey(decoded.make) !== makeKey(make)) {
      rejections.push(`oem_make_conflict:${decoded.make}!=${make}`);
      continue;
    }

    // Where the part number also pins the chassis, the model must agree.
    if (decoded?.model && fitmentKey(decoded.model) !== fitmentKey(model)) {
      const decodedLabels = expandModelLabels(decoded.make, decoded.model).map(fitmentKey);
      if (!decodedLabels.includes(fitmentKey(model))) {
        rejections.push(`oem_model_conflict:${decoded.model}!=${model}`);
        continue;
      }
    }

    // One row per garage spelling of the same vehicle, because fitment
    // matching is an exact key comparison on the model string.
    for (const label of expandModelLabels(make, model)) {
      const dedupe = `${makeKey(make)}|${fitmentKey(label)}|${yearMin}|${yearMax}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({
        make,
        model: label,
        year_min: yearMin,
        year_max: yearMax,
        source: 'ai',
        confidence: Math.min(1, Math.max(0, confidence)),
        verified_by: decoded && !decoded.weak ? 'vehicle-catalog+oem' : 'vehicle-catalog',
      });
    }
  }

  if (rows.length === 0) {
    return {
      status: 'staged',
      fitment: [],
      rejections: rejections.length ? rejections : ['all_claims_rejected'],
      reason: 'all_claims_rejected',
      part_number: partNumber,
    };
  }

  return { status: 'published', fitment: rows, rejections, reason: 'verified', part_number: partNumber };
}

/** Aggregates verification outcomes into the dry-run accuracy report. */
export function summarize(verdicts) {
  const summary = {
    total: verdicts.length,
    published: 0,
    universal: 0,
    staged: 0,
    fitment_rows: 0,
    rejections: {},
  };
  for (const v of verdicts) {
    summary[v.status] += 1;
    summary.fitment_rows += v.fitment.length;
    for (const reason of v.rejections) {
      const bucket = String(reason).split(':')[0];
      summary.rejections[bucket] = (summary.rejections[bucket] || 0) + 1;
    }
  }
  return summary;
}
