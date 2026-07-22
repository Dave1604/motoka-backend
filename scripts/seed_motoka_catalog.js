/**
 * Multi-source Motoka Ladipo catalog orchestrator.
 *
 * Primary (images + NGN + all Motoka categories):
 *   1. Autofactor NG  — scripts/import-ladipo-autofactor.js
 *   2. Ladipo Market  — scripts/import-ladipo-market.js
 *
 * Secondary (Camry / C300 fitment enrichment only):
 *   3. RockAuto       — scripts/seed_motoka_inventory.py --enrich-fitment
 *
 * Title-inferred fitment for scraped rows that still lack compatibility:
 *   4. scripts/backfill-ladipo-compatibility.js
 *
 * Prerequisites:
 *   - Apply Supabase migrations through 072_ladipo_fitment_matching.sql
 *   - .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   - For RockAuto: .venv-seed with scripts/requirements-motoka-inventory.txt
 *
 * Examples:
 *   node scripts/seed_motoka_catalog.js --dry-run --limit 30
 *   node scripts/seed_motoka_catalog.js --source all --limit 200 --per-category 40
 *   node scripts/seed_motoka_catalog.js --source autofactor --limit 100
 *   node scripts/seed_motoka_catalog.js --source ladipo-market --limit 100
 *   node scripts/seed_motoka_catalog.js --source rockauto --limit 50
 *   node scripts/seed_motoka_catalog.js --source all --with-rockauto --limit 100
 *   node scripts/seed_motoka_catalog.js --source all --with-backfill --limit 100
 *
 * Partner runbook:
 *   1. Autofactor + Ladipo Market build the Motoka catalog (seller Motoka, stock 50).
 *   2. RockAuto is optional — merge Camry/C300 compatibility onto matching SKUs/part numbers;
 *      never prefer RockAuto USD-converted prices or Heart.png over NG HTTPS images/NGN.
 *   3. Run backfill-ladipo-compatibility.js after NG imports for title-inferred make/model/year.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SOURCES = new Set(['autofactor', 'ladipo-market', 'rockauto', 'all']);

function parseArgs(argv) {
  const options = {
    source: 'all',
    limit: 200,
    perCategory: 50,
    dryRun: false,
    withRockauto: false,
    withBackfill: false,
    delayMs: 1500,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--source' && next) {
      options.source = String(next).trim().toLowerCase();
      i += 1;
    } else if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10);
      i += 1;
    } else if ((arg === '--per-category' || arg === '--perCategory') && next) {
      options.perCategory = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--delay-ms' && next) {
      options.delayMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--with-rockauto') {
      options.withRockauto = true;
    } else if (arg === '--with-backfill') {
      options.withBackfill = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  if (!SOURCES.has(options.source)) {
    throw new Error(`--source must be one of: ${[...SOURCES].join(', ')}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  if (!Number.isInteger(options.perCategory) || options.perCategory < 1) {
    throw new Error('--per-category must be a positive integer');
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n[seed_motoka_catalog] ▶ ${label}`);
    console.log(`[seed_motoka_catalog]   $ ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function resolvePython() {
  const venvPython = join(ROOT, '.venv-seed', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function runAutofactor(options) {
  const args = [
    'scripts/import-ladipo-autofactor.js',
    '--limit', String(options.limit),
    '--per-category', String(options.perCategory),
    '--seller', 'Motoka',
  ];
  if (options.dryRun) args.push('--dry-run');
  await runCommand(process.execPath, args, 'Autofactor NG import');
}

async function runLadipoMarket(options) {
  const args = [
    'scripts/import-ladipo-market.js',
    '--limit', String(options.limit),
    '--per-category', String(options.perCategory),
    '--seller', 'Motoka',
  ];
  if (options.dryRun) args.push('--dry-run');
  await runCommand(process.execPath, args, 'Ladipo Market import');
}

async function runRockauto(options) {
  const python = resolvePython();
  const args = [
    'scripts/seed_motoka_inventory.py',
    '--enrich-fitment',
    '--limit', String(options.limit),
    '--seller-label', 'Motoka',
    '--stock-qty', '50',
  ];
  if (options.dryRun) args.push('--dry-run');
  await runCommand(python, args, 'RockAuto fitment enrichment (Camry + C300)');
}

async function runBackfill(options) {
  const args = [
    'scripts/backfill-ladipo-compatibility.js',
    '--limit', String(Math.max(options.limit, 500)),
  ];
  if (options.dryRun) args.push('--dry-run');
  await runCommand(process.execPath, args, 'Title-inferred compatibility backfill');
}

function printHelp() {
  console.log(`Usage: node scripts/seed_motoka_catalog.js [options]

Options:
  --source <name>     autofactor | ladipo-market | rockauto | all (default: all)
                      "all" runs Autofactor then Ladipo Market
  --limit <n>         Overall product limit passed to each source (default: 200)
  --per-category <n>  Per-category cap for NG scrapers (default: 50)
  --dry-run           Crawl/preview only; no DB writes
  --with-rockauto     After NG sources, run RockAuto --enrich-fitment
  --with-backfill     After imports, run backfill-ladipo-compatibility.js
  --delay-ms <n>      Pause between sources (default: 1500)

Dedup rules (enforced in importers):
  - Prefer HTTPS product images over empty / Heart.png
  - Prefer Autofactor / Ladipo Market NGN prices over RockAuto USD→NGN
  - Merge compatibility (union of make/model/year ranges)
  - Store specifications.source + source_url for audit
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log(
    `[seed_motoka_catalog] source=${options.source} limit=${options.limit} `
    + `perCategory=${options.perCategory} dryRun=${options.dryRun} `
    + `withRockauto=${options.withRockauto} withBackfill=${options.withBackfill}`
  );

  const runNg = options.source === 'all' || options.source === 'autofactor' || options.source === 'ladipo-market';
  const runAf = options.source === 'all' || options.source === 'autofactor';
  const runLm = options.source === 'all' || options.source === 'ladipo-market';
  const runRa = options.source === 'rockauto' || options.withRockauto;

  if (runAf) {
    await runAutofactor(options);
    if (runLm || runRa || options.withBackfill) await sleep(options.delayMs);
  }

  if (runLm) {
    await runLadipoMarket(options);
    if (runRa || options.withBackfill) await sleep(options.delayMs);
  }

  if (runRa) {
    await runRockauto(options);
    if (options.withBackfill) await sleep(options.delayMs);
  }

  // Default backfill after NG-only "all" when explicitly requested; also allow
  // after any source when --with-backfill is set.
  if (options.withBackfill || (runNg && options.source === 'all' && !options.dryRun && process.env.MOTOKA_CATALOG_AUTO_BACKFILL === '1')) {
    await runBackfill(options);
  }

  console.log('\n[seed_motoka_catalog] done');
}

main().catch((error) => {
  console.error(`[seed_motoka_catalog] Fatal: ${error.message}`);
  process.exit(1);
});
