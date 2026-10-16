/**
 * AI extraction pass for the Ladipo catalog.
 *
 * Scraped listings are written for humans skimming a shop page, not for a
 * database: "Genuine MAF Sensor (LR019830)" carries its make only inside a
 * part number, and "Mercedes Benz Rear Wiper Blade A1678204903" defeats any
 * token-position parser. An LLM reads these the way a parts clerk would.
 *
 * This module only *proposes*. Nothing it returns is trusted until
 * ladipoFitmentVerify.js has checked it against the vehicle catalog and the
 * part number. The prompt is therefore tuned for honesty over coverage: an
 * abstention costs us one product, an invented fitment costs us the feature.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', 'ai-fitment-cache.json');

// The free tier meters requests per project *per model*, so a spent model is
// not a spent key — rotating gives the run a fresh allowance. Ordered best
// first; the lite models are the reserve tank for a large catalogue run.
const MODEL_CANDIDATES = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
];

// Each request is metered the same whether it carries 4 listings or 24, and
// the models allow 64k output tokens, so batching wider turns a fixed daily
// request allowance into several times the catalogue.
const DEFAULT_BATCH_SIZE = 20;
const MAX_OUTPUT_TOKENS = 32_768;
const REQUEST_TIMEOUT_MS = 120_000;

// Transient upstream conditions: worth waiting out, because the alternative is
// staging every product in the batch out of the catalogue.
const BUSY_ERROR = /503|429|500|high demand|overloaded|unavailable|TIMEOUT|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i;
const MAX_BUSY_ATTEMPTS = 5;
const BUSY_BACKOFF_BASE_MS = 2_000;
const BUSY_BACKOFF_MAX_MS = 30_000;

// A spent quota also arrives as a 429, but it is the one refusal backing off
// cannot fix — the key is out of budget for the day, not momentarily busy.
// Retrying it burns half a minute per batch and still abstains, so it is
// detected separately and aborts the pass instead.
const QUOTA_ERROR = /exceeded your current quota|check your plan and billing|RESOURCE_EXHAUSTED|quota exceeded/i;

export class QuotaExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export const CANONICAL_CATEGORY_SLUGS = [
  'spare-parts',
  'spare-parts-brake-wheel-hub-bearings',
  'spare-parts-suspension-parts',
  'spare-parts-engine-parts',
  'spare-parts-steering-parts',
  'spare-parts-exhaust-system',
  'spare-parts-transmission-drivetrain',
  'servicing-parts',
  'servicing-parts-oil-filter',
  'servicing-parts-air-filter',
  'servicing-parts-spark-plugs',
  'servicing-parts-fuel-filter',
  'servicing-parts-timing-belts',
  'lubricants-fluids',
  'lubricants-fluids-engine-oil',
  'lubricants-fluids-gear-oil',
  'lubricants-fluids-brake-fluid-coolant',
  'tyres-wheels',
  'tyres-wheels-car-tyres',
  'tyres-wheels-alloy-wheels',
  'electrical-batteries',
  'electrical-batteries-car-batteries',
  'electrical-batteries-bulbs-lighting',
  'electrical-batteries-alternators',
  'car-accessories',
  'car-accessories-interior',
  'car-accessories-exterior',
];

const SYSTEM_PROMPT = `You are an automotive parts cataloguer for a Nigerian auto-parts marketplace.
For each listing you receive, work out what the product is and which vehicles it fits.

Return a JSON object: {"results": [ ... ]}, one entry per input, in the same order,
each keyed by the input "ref". Each entry has exactly these fields:

{
  "ref": string,                      // copy from the input, never change it
  "normalized_name": string,          // clean product title, Title Case, no shop slogans or ALL CAPS
  "brand": string|null,               // manufacturer of the PART (Bosch, Denso, NGK) or the OEM (Toyota) if genuine
  "part_number": string|null,         // OEM or aftermarket number if one appears in the text
  "category_slug": string,            // one of the allowed slugs, exactly as written
  "condition": "new"|"tokunbo"|"nigerian_used",
  "part_type": "oem"|"oes"|"aftermarket",
  "is_universal": boolean,            // true ONLY for genuinely vehicle-agnostic goods
  "fitment": [ { "make": string, "model": string, "year_min": number|null, "year_max": number|null } ],
  "confidence": number,               // 0.0-1.0, your honest confidence in the fitment array
  "abstain": boolean,                 // true when you cannot determine fitment
  "reasoning": string                 // one short sentence naming the evidence you used
}

RULES — these matter more than producing an answer:

1. ABSTAINING IS A CORRECT ANSWER. If the listing does not tell you which vehicle
   the part fits, set "abstain": true, "fitment": [] and "confidence" below 0.3.
   Never guess a popular model just to fill the field. A wrong fitment is far
   worse than no fitment, because a customer buys the wrong part and loses trust.

2. EVERY fitment entry must be justified in "reasoning" by concrete evidence from
   the listing: an OEM part number whose prefix identifies the manufacturer, an
   explicit model name, or an explicit year range. If your only evidence is that
   the part is "common on Toyotas", abstain.

3. Use OEM part numbers when present. Examples of decodable prefixes:
   - A + 10 digits = Mercedes-Benz; digits 2-4 are the chassis (A167 = GLE-Class,
     A205 = C-Class 2015+, A213 = E-Class 2016+, A204 = C-Class 2008-2014,
     A166 = M-Class/GLE 2012-2018, A222 = S-Class 2014+, A463 = G-Class)
   - LR + 6 digits = Land Rover
   - 5 digits + dash + 5 alphanumerics ending in a letter = Nissan/Infiniti
   - 5 digits + dash + 5 digits = Toyota/Lexus or Hyundai/Kia (ambiguous —
     use the rest of the title to decide, or abstain)
   - 5 digits + dash + 3 alphanumerics + dash + 3 alphanumerics = Honda/Acura

4. Give MODEL names, not trim or engine codes, unless the trim is how the vehicle
   is normally named in Nigeria. "C300", "ES350", "GLE-Class", "Camry", "Hilux"
   are all fine. Do not invent models. Do not return a make with no model — if you
   only know the make, abstain.

5. is_universal is true ONLY for: engine oil, gear oil, brake fluid, coolant,
   grease, additives, car-care chemicals, cleaning products, tools, generic
   cabin accessories (mats, covers, air fresheners), and generic bulbs sold by
   fitting size. Everything else is false. When is_universal is true, return
   "fitment": [] and "abstain": false.

6. Year ranges must be the generation the part fits, never wider. Omit them
   (null) rather than guessing. Never span more than 25 years.

7. condition: "new" unless the listing says otherwise. "tokunbo" means imported
   used. "nigerian_used" means locally used.

8. part_type: "oem" if the listing says Genuine/OEM and names the vehicle maker,
   "oes" for original-equipment suppliers (Bosch, Denso, Aisin, NGK, Mann, Gates,
   Valeo, TYC), "aftermarket" otherwise.

Return ONLY the JSON object. No markdown fences, no commentary.`;

let _model = null;
let _modelName = null;
function getModel() {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set — cannot run AI fitment extraction');
  const genAI = new GoogleGenerativeAI(apiKey);
  const name = _modelName || MODEL_CANDIDATES[0];
  _model = genAI.getGenerativeModel({
    model: name,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });
  _modelName = name;
  return _model;
}

function rotateModel() {
  const idx = MODEL_CANDIDATES.indexOf(_modelName);
  const next = MODEL_CANDIDATES[(idx + 1) % MODEL_CANDIDATES.length];
  if (next === _modelName) return false;
  _model = null;
  _modelName = next;
  console.warn(`[ai-fitment] switching model to ${next}`);
  return true;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cache = null;

function cacheKey(product) {
  return createHash('sha1')
    .update([product.slug, product.title, product.description || '', product.category_slug || ''].join('\u0000'))
    .digest('hex');
}

export function loadCache() {
  if (cache) return cache;
  cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};
  return cache;
}

export function saveCache() {
  if (!cache) return;
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function buildBatchPrompt(products) {
  const listings = products.map((p, i) => ({
    ref: p.ref ?? String(i),
    title: p.title,
    description: (p.description || '').slice(0, 600),
    scraped_category: p.category_slug || null,
    brand_hint: p.brand || null,
    price_naira: p.price_kobo != null ? Math.round(p.price_kobo / 100) : null,
  }));

  return [
    SYSTEM_PROMPT,
    `\nAllowed category_slug values (use exactly one):\n${CANONICAL_CATEGORY_SLUGS.join('\n')}`,
    `\nListings (${listings.length}):\n${JSON.stringify(listings, null, 2)}`,
  ].join('\n');
}

function parseResponse(text) {
  // responseMimeType JSON usually removes fences, but a stray one is cheap to survive.
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  const results = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(results)) throw new Error('Model response had no results array');
  return results;
}

function abstention(ref, product, reason) {
  return {
    ref,
    normalized_name: product?.title ?? null,
    brand: product?.brand ?? null,
    part_number: null,
    category_slug: product?.category_slug ?? null,
    condition: 'new',
    part_type: 'aftermarket',
    is_universal: false,
    fitment: [],
    confidence: 0,
    abstain: true,
    reasoning: reason,
  };
}

async function callModel(products, attempt = 1, rotations = 0) {
  const model = getModel();
  try {
    const result = await Promise.race([
      model.generateContent(buildBatchPrompt(products)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), REQUEST_TIMEOUT_MS)
      ),
    ]);
    return parseResponse(result.response.text());
  } catch (err) {
    const message = String(err.message);

    // Quota is metered per model, so a spent model is not a spent key. Move to
    // the next candidate immediately — backing off cannot refill the one we
    // just drained, and only a run that has drained every candidate is stuck.
    if (QUOTA_ERROR.test(message)) {
      if (rotations < MODEL_CANDIDATES.length - 1 && rotateModel()) {
        return callModel(products, 1, rotations + 1);
      }
      throw new QuotaExhaustedError(message);
    }

    const busy = BUSY_ERROR.test(message);

    // A "high demand" 503 clears in seconds, but the batch behind it abstains
    // permanently — every product in it is staged out of the live catalogue on
    // a temporary outage. That is worth waiting out properly rather than the
    // one 800ms retry this used to get. Models are only rotated once backing
    // off has stopped helping, and each candidate gets its own fresh budget.
    if (busy) {
      if (attempt >= MAX_BUSY_ATTEMPTS) {
        if (rotations < MODEL_CANDIDATES.length - 1 && rotateModel()) {
          return callModel(products, 1, rotations + 1);
        }
        throw err;
      }
      const backoff = Math.min(BUSY_BACKOFF_BASE_MS * 2 ** (attempt - 1), BUSY_BACKOFF_MAX_MS);
      await new Promise((r) => setTimeout(r, backoff + Math.floor(Math.random() * 500)));
      return callModel(products, attempt + 1, rotations);
    }

    // A malformed response is a bug in the prompt or the parser, not weather.
    // One retry, then let the batch abstain.
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return callModel(products, attempt + 1, rotations);
  }
}

/**
 * @param {Array<{slug, title, description?, brand?, category_slug?, price_kobo?}>} products
 * @param {{batchSize?: number, useCache?: boolean, onProgress?: Function}} options
 * @returns {Promise<Map<string, object>>} keyed by product slug
 */
export async function extractFitment(products, options = {}) {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    useCache = true,
    onProgress = () => {},
  } = options;

  const store = loadCache();
  const out = new Map();
  const pending = [];

  for (const product of products) {
    const key = cacheKey(product);
    if (useCache && store[key]) {
      out.set(product.slug, store[key]);
    } else {
      pending.push({ ...product, ref: product.slug, _cacheKey: key });
    }
  }

  onProgress({ phase: 'start', total: products.length, cached: out.size, pending: pending.length });

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    let results;
    try {
      results = await callModel(batch);
    } catch (err) {
      // A dead batch must not sink the run. Every product in it abstains,
      // which under strict publishing means staged — unless the OEM fallback
      // in the pipeline can still recover a chassis-coded part number.
      for (const p of batch) out.set(p.slug, abstention(p.slug, p, `extraction_failed: ${err.message}`));
      onProgress({ phase: 'batch', index: i, size: batch.length, error: err.message });

      // Once the quota is gone every remaining batch would fail the same way.
      // Abstain the rest in one go rather than spending the run discovering
      // that one batch at a time, and say so loudly — a run that quietly
      // stages most of the catalogue looks like a bad crawl, not a spent key.
      if (err instanceof QuotaExhaustedError) {
        const remaining = pending.slice(i + batchSize);
        for (const p of remaining) {
          out.set(p.slug, abstention(p.slug, p, 'extraction_failed: quota exhausted'));
        }
        console.warn(
          `[ai-fitment] QUOTA EXHAUSTED ON ALL ${MODEL_CANDIDATES.length} MODELS — `
          + `${batch.length + remaining.length} of ${pending.length} listings could not `
          + `be classified and will be staged (is_active=false). Re-run tomorrow, or `
          + `enable billing on the key to lift the free-tier cap; work already done is `
          + `cached, so the re-run only retries these.`
        );
        onProgress({ phase: 'quota-exhausted', remaining: batch.length + remaining.length });
        break;
      }
      continue;
    }

    const byRef = new Map(results.map((r) => [String(r.ref), r]));
    for (const p of batch) {
      const raw = byRef.get(String(p.ref));
      const entry = raw
        ? { ...raw, ref: p.slug }
        : abstention(p.slug, p, 'model_omitted_this_listing');
      out.set(p.slug, entry);
      store[p._cacheKey] = entry;
    }

    onProgress({ phase: 'batch', index: i, size: batch.length, done: Math.min(i + batchSize, pending.length), pending: pending.length });
    saveCache();
  }

  return out;
}
