/**
 * Builds scripts/data/vehicle-catalog.json — the reference every AI fitment
 * claim is checked against.
 *
 * Two sources, because neither is sufficient alone:
 *
 *   NHTSA vPIC  free, authoritative, no key, but US-market only. It knows
 *               every Camry year ever built and has never heard of a Hilux.
 *   NG_SUPPLEMENT  hand-maintained. The Nigerian fleet is largely imported
 *               used stock from Europe and Japan, so a lot of it simply does
 *               not appear in a US regulatory database.
 *
 *   node scripts/build-vehicle-catalog.js
 *   node scripts/build-vehicle-catalog.js --years 2000-2027 --concurrency 8
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fitmentKey, makeKey, CATALOG_PATH } from './lib/vehicleCatalog.js';

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';

// Makes worth spending requests on: the Nigerian road fleet, not all 900+
// manufacturers vPIC knows about.
const TARGET_MAKES = [
  'Toyota', 'Honda', 'Nissan', 'Lexus', 'Mercedes-Benz', 'BMW', 'Ford',
  'Hyundai', 'Kia', 'Volkswagen', 'Peugeot', 'Mazda', 'Mitsubishi', 'Suzuki',
  'Land Rover', 'Acura', 'Infiniti', 'Audi', 'Chevrolet', 'Jeep', 'Volvo',
  'Subaru', 'Isuzu', 'Renault', 'Daihatsu', 'Chrysler', 'Dodge', 'GMC',
  'Cadillac', 'Jaguar', 'Porsche', 'Mini', 'Fiat',
];

// Passenger-vehicle types. Without this filter Honda returns 60+ motorcycles
// and ATVs, none of which anyone is buying brake pads for here.
const VEHICLE_TYPES = ['car', 'truck', 'mpv'];

/**
 * Models absent from vPIC, plus trim-level names Nigerians actually type into
 * their garage. `labels` are alternative spellings for the same vehicle — a
 * compatibility row is written for each so exact-key matching still lands.
 * Sibling trims are never cross-listed.
 */
const NG_SUPPLEMENT = {
  Toyota: {
    Hilux: { year_min: 1995, year_max: 2027, labels: ['Hilux', 'Hi-Lux'] },
    Hiace: { year_min: 1995, year_max: 2027, labels: ['Hiace', 'Hi-Ace'] },
    'Land Cruiser Prado': { year_min: 1996, year_max: 2027, labels: ['Prado', 'Land Cruiser Prado', 'LC Prado'] },
    'Land Cruiser': { year_min: 1995, year_max: 2027, labels: ['Land Cruiser', 'Landcruiser', 'LC200', 'LC300'] },
    Avensis: { year_min: 1997, year_max: 2018 },
    Rush: { year_min: 2006, year_max: 2027 },
    Fortuner: { year_min: 2005, year_max: 2027 },
    Innova: { year_min: 2004, year_max: 2027 },
    'Corolla Quest': { year_min: 2014, year_max: 2027, labels: ['Corolla Quest'] },
    Picnic: { year_min: 1996, year_max: 2009 },
    Coaster: { year_min: 1995, year_max: 2027 },
    Dyna: { year_min: 1995, year_max: 2020 },
    Verso: { year_min: 2001, year_max: 2018, labels: ['Verso', 'Corolla Verso'] },
    Etios: { year_min: 2010, year_max: 2022 },
    Vitz: { year_min: 1999, year_max: 2027 },
    Allion: { year_min: 2001, year_max: 2027 },
    Premio: { year_min: 2001, year_max: 2027 },
  },
  Honda: {
    City: { year_min: 1996, year_max: 2027 },
    Jazz: { year_min: 2001, year_max: 2027 },
    Stream: { year_min: 2000, year_max: 2014 },
    Crosstour: { year_min: 2010, year_max: 2015 },
    'CR-V': { year_min: 1995, year_max: 2027, labels: ['CR-V', 'CRV'] },
    'HR-V': { year_min: 1998, year_max: 2027, labels: ['HR-V', 'HRV'] },
  },
  Nissan: {
    'X-Trail': { year_min: 2000, year_max: 2027, labels: ['X-Trail', 'XTrail'] },
    Qashqai: { year_min: 2006, year_max: 2027 },
    Primera: { year_min: 1995, year_max: 2008 },
    Almera: { year_min: 1995, year_max: 2027 },
    Micra: { year_min: 1995, year_max: 2027 },
    Patrol: { year_min: 1995, year_max: 2027 },
    Navara: { year_min: 1997, year_max: 2027 },
    Sunny: { year_min: 1995, year_max: 2027 },
    Note: { year_min: 2004, year_max: 2027 },
    Serena: { year_min: 1995, year_max: 2027 },
    Tiida: { year_min: 2004, year_max: 2020 },
  },
  'Mercedes-Benz': {
    'C-Class': { year_min: 1995, year_max: 2027, labels: ['C-Class', 'C Class'] },
    C180: { year_min: 1995, year_max: 2021, labels: ['C180', 'C-Class'] },
    C200: { year_min: 1995, year_max: 2027, labels: ['C200', 'C-Class'] },
    C230: { year_min: 1996, year_max: 2007, labels: ['C230', 'C-Class'] },
    C240: { year_min: 1998, year_max: 2005, labels: ['C240', 'C-Class'] },
    C250: { year_min: 2008, year_max: 2015, labels: ['C250', 'C-Class'] },
    C280: { year_min: 1995, year_max: 2007, labels: ['C280', 'C-Class'] },
    C300: { year_min: 2008, year_max: 2027, labels: ['C300', 'C-Class'] },
    C350: { year_min: 2006, year_max: 2015, labels: ['C350', 'C-Class'] },
    'E-Class': { year_min: 1995, year_max: 2027, labels: ['E-Class', 'E Class'] },
    E200: { year_min: 1995, year_max: 2027, labels: ['E200', 'E-Class'] },
    E230: { year_min: 1995, year_max: 2008, labels: ['E230', 'E-Class'] },
    E240: { year_min: 1997, year_max: 2005, labels: ['E240', 'E-Class'] },
    E280: { year_min: 1995, year_max: 2009, labels: ['E280', 'E-Class'] },
    E300: { year_min: 1995, year_max: 2027, labels: ['E300', 'E-Class'] },
    E320: { year_min: 1995, year_max: 2009, labels: ['E320', 'E-Class'] },
    E350: { year_min: 2006, year_max: 2027, labels: ['E350', 'E-Class'] },
    'S-Class': { year_min: 1995, year_max: 2027, labels: ['S-Class', 'S Class'] },
    S350: { year_min: 1995, year_max: 2027, labels: ['S350', 'S-Class'] },
    S550: { year_min: 2007, year_max: 2020, labels: ['S550', 'S-Class'] },
    'G-Class': { year_min: 1995, year_max: 2027, labels: ['G-Class', 'G Class', 'G-Wagon', 'G Wagon'] },
    G550: { year_min: 2009, year_max: 2027, labels: ['G550', 'G-Class', 'G-Wagon'] },
    'G63 AMG': { year_min: 2013, year_max: 2027, labels: ['G63 AMG', 'G63', 'G-Class', 'G-Wagon'] },
    'GLK-Class': { year_min: 2009, year_max: 2015, labels: ['GLK-Class', 'GLK'] },
    GLK350: { year_min: 2010, year_max: 2015, labels: ['GLK350', 'GLK', 'GLK-Class'] },
    'M-Class': { year_min: 1998, year_max: 2015, labels: ['M-Class', 'ML'] },
    ML350: { year_min: 2003, year_max: 2015, labels: ['ML350', 'ML', 'M-Class'] },
    'GLE-Class': { year_min: 2016, year_max: 2027, labels: ['GLE-Class', 'GLE'] },
    GLE350: { year_min: 2016, year_max: 2027, labels: ['GLE350', 'GLE', 'GLE-Class'] },
    'GLC-Class': { year_min: 2016, year_max: 2027, labels: ['GLC-Class', 'GLC'] },
    'GLA-Class': { year_min: 2014, year_max: 2027, labels: ['GLA-Class', 'GLA'] },
    'GLS-Class': { year_min: 2017, year_max: 2027, labels: ['GLS-Class', 'GLS'] },
    Sprinter: { year_min: 1995, year_max: 2027 },
  },
  Lexus: {
    ES: { year_min: 1995, year_max: 2027, labels: ['ES'] },
    ES330: { year_min: 2004, year_max: 2006, labels: ['ES330', 'ES'] },
    ES350: { year_min: 2007, year_max: 2027, labels: ['ES350', 'ES'] },
    RX: { year_min: 1999, year_max: 2027, labels: ['RX'] },
    RX300: { year_min: 1999, year_max: 2003, labels: ['RX300', 'RX'] },
    RX330: { year_min: 2004, year_max: 2006, labels: ['RX330', 'RX'] },
    RX350: { year_min: 2007, year_max: 2027, labels: ['RX350', 'RX'] },
    GX: { year_min: 2003, year_max: 2027, labels: ['GX'] },
    GX460: { year_min: 2010, year_max: 2027, labels: ['GX460', 'GX'] },
    GX470: { year_min: 2003, year_max: 2009, labels: ['GX470', 'GX'] },
    LX: { year_min: 1996, year_max: 2027, labels: ['LX'] },
    LX470: { year_min: 1998, year_max: 2007, labels: ['LX470', 'LX'] },
    LX570: { year_min: 2008, year_max: 2027, labels: ['LX570', 'LX'] },
    IS: { year_min: 1999, year_max: 2027, labels: ['IS'] },
    IS250: { year_min: 2006, year_max: 2015, labels: ['IS250', 'IS'] },
    IS300: { year_min: 2001, year_max: 2027, labels: ['IS300', 'IS'] },
    NX: { year_min: 2015, year_max: 2027 },
    RC: { year_min: 2015, year_max: 2027 },
  },
  Peugeot: {
    206: { year_min: 1998, year_max: 2012 },
    207: { year_min: 2006, year_max: 2014 },
    301: { year_min: 2012, year_max: 2027 },
    307: { year_min: 2001, year_max: 2014 },
    308: { year_min: 2007, year_max: 2027 },
    405: { year_min: 1995, year_max: 1999 },
    406: { year_min: 1995, year_max: 2004 },
    407: { year_min: 2004, year_max: 2011 },
    508: { year_min: 2011, year_max: 2027 },
    3008: { year_min: 2009, year_max: 2027 },
    5008: { year_min: 2009, year_max: 2027 },
    Partner: { year_min: 1996, year_max: 2027 },
    Boxer: { year_min: 1995, year_max: 2027 },
  },
  Hyundai: {
    i10: { year_min: 2007, year_max: 2027, labels: ['i10', 'Grand i10'] },
    i20: { year_min: 2008, year_max: 2027 },
    i30: { year_min: 2007, year_max: 2027 },
    ix35: { year_min: 2009, year_max: 2015 },
    Creta: { year_min: 2015, year_max: 2027 },
    Getz: { year_min: 2002, year_max: 2011 },
    Matrix: { year_min: 2001, year_max: 2010 },
    'H-1': { year_min: 1997, year_max: 2027, labels: ['H-1', 'H1'] },
  },
  Kia: {
    Rio: { year_min: 2000, year_max: 2027 },
    Picanto: { year_min: 2004, year_max: 2027 },
    Cerato: { year_min: 2003, year_max: 2027 },
    Carnival: { year_min: 1998, year_max: 2027 },
    Ceed: { year_min: 2006, year_max: 2027 },
    Pride: { year_min: 1995, year_max: 2011 },
  },
  Volkswagen: {
    Golf: { year_min: 1995, year_max: 2027 },
    Passat: { year_min: 1995, year_max: 2027 },
    Polo: { year_min: 1995, year_max: 2027 },
    Touareg: { year_min: 2003, year_max: 2027 },
    Tiguan: { year_min: 2008, year_max: 2027 },
    Amarok: { year_min: 2010, year_max: 2027 },
    Sharan: { year_min: 1995, year_max: 2022 },
    Caddy: { year_min: 1995, year_max: 2027 },
    Transporter: { year_min: 1995, year_max: 2027 },
  },
  'Land Rover': {
    'Range Rover': { year_min: 1995, year_max: 2027 },
    'Range Rover Sport': { year_min: 2005, year_max: 2027 },
    'Range Rover Evoque': { year_min: 2011, year_max: 2027, labels: ['Range Rover Evoque', 'Evoque'] },
    Discovery: { year_min: 1995, year_max: 2027 },
    Defender: { year_min: 1995, year_max: 2027 },
    Freelander: { year_min: 1997, year_max: 2014 },
  },
  Mitsubishi: {
    Pajero: { year_min: 1995, year_max: 2027 },
    L200: { year_min: 1995, year_max: 2027 },
    Canter: { year_min: 1995, year_max: 2027 },
    'Space Star': { year_min: 1998, year_max: 2027 },
    Lancer: { year_min: 1995, year_max: 2027 },
    Outlander: { year_min: 2001, year_max: 2027 },
  },
  Suzuki: {
    Alto: { year_min: 1995, year_max: 2027 },
    Swift: { year_min: 1995, year_max: 2027 },
    Vitara: { year_min: 1995, year_max: 2027 },
    Jimny: { year_min: 1998, year_max: 2027 },
    Every: { year_min: 1995, year_max: 2027 },
    Carry: { year_min: 1995, year_max: 2027 },
  },
  Isuzu: {
    'D-Max': { year_min: 2002, year_max: 2027, labels: ['D-Max', 'DMax'] },
    NPR: { year_min: 1995, year_max: 2027 },
    NQR: { year_min: 1995, year_max: 2027 },
  },
  Daihatsu: {
    Hijet: { year_min: 1995, year_max: 2027 },
    Terios: { year_min: 1997, year_max: 2027 },
    HiMax: { year_min: 2017, year_max: 2027 },
  },
  Ford: {
    Ranger: { year_min: 1995, year_max: 2027 },
    Transit: { year_min: 1995, year_max: 2027 },
  },
  BMW: {
    '3-Series': { year_min: 1995, year_max: 2027, labels: ['3-Series', '3 Series'] },
    '320i': { year_min: 1995, year_max: 2027, labels: ['320i', '3-Series'] },
    '328i': { year_min: 1996, year_max: 2016, labels: ['328i', '3-Series'] },
    '330i': { year_min: 2001, year_max: 2027, labels: ['330i', '3-Series'] },
    '5-Series': { year_min: 1995, year_max: 2027, labels: ['5-Series', '5 Series'] },
    '520i': { year_min: 1995, year_max: 2027, labels: ['520i', '5-Series'] },
    '528i': { year_min: 1996, year_max: 2016, labels: ['528i', '5-Series'] },
    '535i': { year_min: 2008, year_max: 2016, labels: ['535i', '5-Series'] },
    '7-Series': { year_min: 1995, year_max: 2027, labels: ['7-Series', '7 Series'] },
    X1: { year_min: 2010, year_max: 2027 },
    X3: { year_min: 2004, year_max: 2027 },
    X5: { year_min: 1999, year_max: 2027 },
    X6: { year_min: 2008, year_max: 2027 },
  },
  Innoson: {
    'IVM G5': { year_min: 2015, year_max: 2027, labels: ['IVM G5', 'G5'] },
    'IVM Fox': { year_min: 2015, year_max: 2027, labels: ['IVM Fox', 'Fox'] },
    'IVM Carrier': { year_min: 2015, year_max: 2027, labels: ['IVM Carrier', 'Carrier'] },
    'IVM Umu': { year_min: 2015, year_max: 2027, labels: ['IVM Umu', 'Umu'] },
  },
};

// vPIC starts returning 403 well before it returns 429, and it does not
// recover quickly. Three workers with a short pause between requests gets a
// clean sweep; ten does not.
const DEFAULT_CONCURRENCY = 3;
const REQUEST_SPACING_MS = 120;

// Sampling every other year halves the request count. Recorded ranges are
// widened by the step so a model sampled at 2016 and 2020 is not wrongly
// treated as absent in 2017.
const DEFAULT_YEAR_STEP = 2;

function parseArgs(argv) {
  const options = {
    yearMin: 1995,
    yearMax: new Date().getFullYear() + 1,
    concurrency: DEFAULT_CONCURRENCY,
    step: DEFAULT_YEAR_STEP,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === '--years' && next) {
      const [a, b] = next.split('-').map((n) => Number.parseInt(n, 10));
      if (Number.isInteger(a)) options.yearMin = a;
      if (Number.isInteger(b)) options.yearMax = b;
      i += 1;
    } else if (argv[i] === '--concurrency' && next) {
      options.concurrency = Math.max(1, Number.parseInt(next, 10) || DEFAULT_CONCURRENCY);
      i += 1;
    } else if (argv[i] === '--step' && next) {
      options.step = Math.max(1, Number.parseInt(next, 10) || DEFAULT_YEAR_STEP);
      i += 1;
    }
  }
  return options;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', 'User-Agent': 'motoka-catalog-builder/1.0' },
    });
    // 403 here means throttled, not forbidden — back off hard rather than
    // burning the remaining budget on requests that will also fail.
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`HTTP ${res.status}`), { throttled: true });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 5) throw err;
    const backoff = err.throttled ? 2000 * attempt : 400 * attempt;
    await sleep(backoff);
    return fetchJson(url, attempt + 1);
  }
}

/** Runs tasks with a bounded worker pool so vPIC is not hammered. */
async function pool(items, size, worker) {
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
        await sleep(REQUEST_SPACING_MS);
      }
    })
  );
  return results;
}

/**
 * Model names that count as passenger vehicles for a make, so the per-year
 * sweep can drop motorcycles without paying for a vehicleType request on
 * every single year.
 */
async function fetchPassengerModels(make) {
  const allowed = new Set();
  for (const type of VEHICLE_TYPES) {
    try {
      const data = await fetchJson(
        `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/2018/vehicleType/${type}?format=json`
      );
      for (const row of data.Results || []) allowed.add(fitmentKey(row.Model_Name));
    } catch {
      /* a missing type for a make is not fatal */
    }
    await sleep(REQUEST_SPACING_MS);
  }
  return allowed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const years = [];
  for (let y = options.yearMin; y <= options.yearMax; y += options.step) years.push(y);
  if (years[years.length - 1] !== options.yearMax) years.push(options.yearMax);

  console.log(
    `[vehicle-catalog] vPIC sweep: ${TARGET_MAKES.length} makes x ${years.length} years ` +
    `(step ${options.step}, concurrency ${options.concurrency})`
  );

  const makes = {};
  const ensureMake = (name) => {
    const key = makeKey(name);
    if (!makes[key]) makes[key] = { name, models: {} };
    return makes[key];
  };

  const recordModel = (makeName, modelName, year, source) => {
    const makeEntry = ensureMake(makeName);
    const key = fitmentKey(modelName);
    if (!key) return;
    const existing = makeEntry.models[key];
    if (!existing) {
      makeEntry.models[key] = {
        name: modelName,
        year_min: year,
        year_max: year,
        labels: [modelName],
        source,
      };
      return;
    }
    if (year != null) {
      existing.year_min = Math.min(existing.year_min ?? year, year);
      existing.year_max = Math.max(existing.year_max ?? year, year);
    }
  };

  // Pass 1 — passenger-vehicle allowlists, one small batch per make.
  const allowlists = new Map();
  await pool(TARGET_MAKES, options.concurrency, async (make) => {
    allowlists.set(make, await fetchPassengerModels(make));
  });
  console.log('[vehicle-catalog] Passenger-vehicle allowlists built');

  // Pass 2 — year sweep. One request per make/year, filtered by the allowlist.
  const jobs = [];
  for (const make of TARGET_MAKES) for (const year of years) jobs.push({ make, year });

  let done = 0;
  let failed = 0;
  await pool(jobs, options.concurrency, async ({ make, year }) => {
    try {
      const data = await fetchJson(
        `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`
      );
      const allowed = allowlists.get(make);
      for (const row of data.Results || []) {
        const name = row.Model_Name;
        if (!name) continue;
        if (allowed && allowed.size > 0 && !allowed.has(fitmentKey(name))) continue;
        recordModel(make, name, year, 'vpic');
      }
    } catch (err) {
      failed += 1;
      console.warn(`[vehicle-catalog] ${make} ${year} failed: ${err.message}`);
    }
    done += 1;
    if (done % 100 === 0) console.log(`[vehicle-catalog]   ${done}/${jobs.length}`);
  });

  // A sampled sweep only proves the model existed in the years it was polled.
  // Widen by the step so the gaps between samples are not read as gaps in
  // production, which would reject legitimate fitment.
  const pad = options.step - 1;
  if (pad > 0) {
    for (const makeEntry of Object.values(makes)) {
      for (const model of Object.values(makeEntry.models)) {
        if (model.source !== 'vpic') continue;
        model.year_min = Math.max(options.yearMin, model.year_min - pad);
        model.year_max = Math.min(options.yearMax, model.year_max + pad);
      }
    }
  }

  const vpicModels = Object.values(makes).reduce((n, m) => n + Object.keys(m.models).length, 0);
  console.log(
    `[vehicle-catalog] vPIC contributed ${vpicModels} models (${failed}/${jobs.length} requests failed)`
  );

  // Pass 3 — Nigerian supplement. Overrides vPIC where both have an opinion,
  // because the local year ranges account for imported non-US generations.
  let supplemented = 0;
  for (const [makeName, models] of Object.entries(NG_SUPPLEMENT)) {
    const makeEntry = ensureMake(makeName);
    for (const [modelName, spec] of Object.entries(models)) {
      const key = fitmentKey(modelName);
      const existing = makeEntry.models[key];
      makeEntry.models[key] = {
        name: modelName,
        year_min: Math.min(spec.year_min, existing?.year_min ?? spec.year_min),
        year_max: Math.max(spec.year_max, existing?.year_max ?? spec.year_max),
        labels: [...new Set([modelName, ...(spec.labels || []), ...(existing?.labels || [])])],
        source: existing ? 'vpic+ng' : 'ng',
      };
      supplemented += 1;
    }
  }
  console.log(`[vehicle-catalog] Nigerian supplement applied to ${supplemented} models`);

  const catalog = {
    generated_at: new Date().toISOString(),
    source: 'NHTSA vPIC + Nigeria supplement',
    year_range: [options.yearMin, options.yearMax],
    makes,
  };

  mkdirSync(dirname(CATALOG_PATH), { recursive: true });
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

  const totalModels = Object.values(makes).reduce((n, m) => n + Object.keys(m.models).length, 0);
  console.log(
    `[vehicle-catalog] Wrote ${CATALOG_PATH}\n` +
    `[vehicle-catalog] ${Object.keys(makes).length} makes, ${totalModels} models`
  );
}

main().catch((err) => {
  console.error(`[vehicle-catalog] Fatal: ${err.message}`);
  process.exit(1);
});
