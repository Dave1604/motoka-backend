import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSupabaseAdmin } from '../src/config/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const DEFAULT_SOURCE = 'ladipomarket.com.ng';

// Maps the lowercase first word of a title to a canonical make name.
const MAKE_ALIASES = new Map([
  ['toyota', 'Toyota'],
  ['honda', 'Honda'],
  ['nissan', 'Nissan'],
  ['mercedes-benz', 'Mercedes-Benz'],
  ['mercedes', 'Mercedes-Benz'],
  ['benz', 'Mercedes-Benz'],
  ['bmw', 'BMW'],
  ['audi', 'Audi'],
  ['ford', 'Ford'],
  ['kia', 'Kia'],
  ['hyundai', 'Hyundai'],
  ['lexus', 'Lexus'],
  ['mazda', 'Mazda'],
  ['mitsubishi', 'Mitsubishi'],
  ['volkswagen', 'Volkswagen'],
  ['vw', 'Volkswagen'],
  ['peugeot', 'Peugeot'],
  ['pegout', 'Peugeot'],
  ['chrysler', 'Chrysler'],
  ['jeep', 'Jeep'],
  ['acura', 'Acura'],
  ['infiniti', 'Infiniti'],
  ['suzuki', 'Suzuki'],
  ['volvo', 'Volvo'],
  ['subaru', 'Subaru'],
  ['mini', 'Mini'],
  ['renault', 'Renault'],
  ['daewoo', 'Daewoo'],
  ['chevrolet', 'Chevrolet'],
  ['jaguar', 'Jaguar'],
  ['cadillac', 'Cadillac'],
  ['gmc', 'GMC'],
  ['pontiac', 'Pontiac'],
  ['dodge', 'Dodge'],
]);

const PART_TYPE_STOP_WORDS = new Set([
  'engine', 'gear', 'gearbox', 'tyre', 'tyres', 'rim', 'rims', 'battery', 'wheel',
  'brake', 'brakes', 'bumper', 'radiator', 'compressor', 'clutch', 'exhaust',
  'mirror', 'mirrors', 'lamp', 'lamps', 'alternator', 'shock', 'absorber',
  'absorbers', 'axle', 'axles', 'cylinder', 'dashboard', 'flywheel', 'gasket',
  'hub', 'injector', 'lock', 'plug', 'plugs', 'oil', 'steering', 'stabilizer',
  'window', 'windows', 'wiper', 'wipers', 'fender', 'grill', 'hanger', 'horn',
  'switch', 'stereo', 'sensor', 'chain', 'cover', 'pump', 'filter', 'crankshaft',
  'rack', 'pad', 'pads', 'condenser', 'evaporator', 'starter', 'tank',
  'windscreen', 'door', 'bonnet', 'glass', 'rack', 'joint', 'shaft', 'arm',
]);

function isNumericish(token) {
  return /^[\d./]+[a-z]{0,2}$/i.test(token) && /\d/.test(token);
}

function parseArgs(argv) {
  const options = { dryRun: false, source: DEFAULT_SOURCE, limit: 10000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--source' && next) { options.source = next; i += 1; }
    else if (arg === '--limit' && next) { options.limit = Number.parseInt(next, 10); i += 1; }
  }
  return options;
}

function parseTitle(name) {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length === 0) return null;

  const make = MAKE_ALIASES.get(tokens[0].toLowerCase());
  if (!make) return null;

  const rest = tokens.slice(1);

  // Years: any 4-digit token in plausible vehicle-year range, in order of appearance.
  const years = [];
  for (const token of rest) {
    const matches = token.match(/\d{4}/g);
    if (!matches) continue;
    for (const m of matches) {
      const year = Number.parseInt(m, 10);
      if (year >= 1980 && year <= 2030) years.push(year);
    }
  }
  const yearMin = years.length > 0 ? Math.min(...years) : null;
  const tillDate = /till date/i.test(name);
  const yearMax = tillDate ? null : (years.length > 1 ? Math.max(...years) : yearMin);

  // Model: tokens after make, stopping at the first part-type keyword or numeric/spec token.
  const modelTokens = [];
  for (const token of rest) {
    const clean = token.replace(/[(),]/g, '');
    const lower = clean.toLowerCase();
    if (PART_TYPE_STOP_WORDS.has(lower)) break;
    if (isNumericish(clean)) break;
    if (lower === 'model' || lower === 'till' || lower === 'date') break;
    modelTokens.push(clean);
  }
  const model = modelTokens.length > 0 ? modelTokens.join(' ') : null;

  if (yearMin === null && model === null) return null;

  return { make, model, year_min: yearMin, year_max: yearMax };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseAdmin();

  console.log(`[backfill-compatibility] Fetching parts from source=${options.source}`);
  const { data: parts, error } = await supabase
    .from('ladipo_parts')
    .select('id, name, is_universal')
    .contains('specifications', { source: options.source })
    .eq('is_active', true)
    .limit(options.limit);

  if (error) throw new Error(`Failed reading parts: ${error.message}`);
  console.log(`[backfill-compatibility] Found ${parts.length} parts`);

  const { data: existingCompat, error: compatError } = await supabase
    .from('ladipo_part_compatibility')
    .select('part_id')
    .in('part_id', parts.map((p) => p.id));
  if (compatError) throw new Error(`Failed reading existing compatibility: ${compatError.message}`);
  const hasCompat = new Set((existingCompat || []).map((c) => c.part_id));

  let parsed = 0;
  let skippedUnparsed = 0;
  let skippedExisting = 0;
  const rows = [];

  for (const part of parts) {
    if (hasCompat.has(part.id)) {
      skippedExisting += 1;
      continue;
    }
    const fit = parseTitle(part.name);
    if (!fit) {
      skippedUnparsed += 1;
      continue;
    }
    parsed += 1;
    rows.push({
      part_id: part.id,
      make: fit.make,
      model: fit.model,
      year_min: fit.year_min,
      year_max: fit.year_max,
    });
  }

  console.log(`[backfill-compatibility] Parsed ${parsed}, skipped (already had compatibility) ${skippedExisting}, skipped (unparseable) ${skippedUnparsed}`);

  if (options.dryRun) {
    console.log('[backfill-compatibility] Dry run preview:');
    console.log(JSON.stringify(rows.slice(0, 20), null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('[backfill-compatibility] Nothing to insert');
    return;
  }

  const { error: insertError } = await supabase.from('ladipo_part_compatibility').insert(rows);
  if (insertError) throw new Error(`Failed inserting compatibility rows: ${insertError.message}`);
  console.log(`[backfill-compatibility] Inserted ${rows.length} compatibility rows`);
}

main().catch((err) => {
  console.error(`[backfill-compatibility] Fatal error: ${err.message}`);
  process.exit(1);
});
