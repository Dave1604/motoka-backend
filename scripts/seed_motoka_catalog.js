/**
 * Motoka Ladipo catalog orchestrator.
 *
 * Pipeline:
 *   1. Crawl autofactorng.com (NGN prices, real OEM numbers, hosted images)
 *   2. Gemini extracts fitment; the vehicle catalog + OEM decoder verify it
 *   3. Upsert: verified/universal go live, the rest are staged is_active=false
 *   4. Optional RockAuto --full enrichment onto matching SKUs
 *   5. Merchandising flags + category images
 *   6. Coverage report for the Nigerian fleet
 *
 *   node scripts/seed_motoka_catalog.js --dry-run --limit 30
 *   node scripts/seed_motoka_catalog.js --limit 400 --per-category 40
 *   node scripts/seed_motoka_catalog.js --source rockauto --limit 80
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { crawlAutofactorProducts } from './import-ladipo-autofactor.js';
import { runCatalogPipeline } from './lib/ladipoCatalogPipeline.js';
import { merchandizeLadipo } from './merchandize-ladipo.js';
import { verifyLadipoCatalog } from './verify-ladipo-catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
config({ path: join(ROOT, '.env') });

const SOURCES = new Set(['autofactor', 'rockauto', 'all']);

function parseArgs(argv) {
  const options = {
    source: 'all',
    limit: 400,
    perCategory: 40,
    maxPages: 60,
    dryRun: false,
    withRockauto: false,
    skipMerch: false,
    skipVerify: false,
    resume: true,
    skipImages: false,
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
    } else if (arg === '--max-pages' && next) {
      options.maxPages = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--delay-ms' && next) {
      options.delayMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--with-rockauto') {
      options.withRockauto = true;
    } else if (arg === '--skip-merch') {
      options.skipMerch = true;
    } else if (arg === '--skip-verify') {
      options.skipVerify = true;
    } else if (arg === '--fresh') {
      options.resume = false;
    } else if (arg === '--skip-images') {
      options.skipImages = true;
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

async function runRockauto(options) {
  const python = resolvePython();
  const args = [
    'scripts/seed_motoka_inventory.py',
    '--enrich-fitment',
    '--full',
    '--limit', String(options.limit),
    '--seller-label', 'Motoka',
    '--stock-qty', '50',
  ];
  if (options.dryRun) args.push('--dry-run');
  await runCommand(python, args, 'RockAuto fitment enrichment (PRODUCTION_VEHICLES)');
}

function printHelp() {
  console.log(`Usage: node scripts/seed_motoka_catalog.js [options]

Options:
  --source <name>     autofactor | rockauto | all (default: all)
  --limit <n>         Overall product cap (default: 400)
  --per-category <n>  Per-category cap for Autofactor (default: 40)
  --dry-run           Extract + verify only; print accuracy report; no DB writes
  --with-rockauto     After Autofactor, merge RockAuto fitment onto matching SKUs
  --fresh             Ignore the pipeline checkpoint and re-process every slug
  --skip-images       Store source image URLs instead of rehosting to Cloudinary
  --skip-merch        Do not set landing-rail flags
  --skip-verify       Do not run the coverage gate at the end
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
    + `perCategory=${options.perCategory} dryRun=${options.dryRun}`
  );

  const runAf = options.source === 'all' || options.source === 'autofactor';
  const runRa = options.source === 'rockauto' || options.withRockauto;

  if (runAf) {
    const products = await crawlAutofactorProducts(
      options.limit,
      options.maxPages,
      options.perCategory
    );
    if (products.length === 0) {
      throw new Error('Autofactor crawl returned no products');
    }
    await runCatalogPipeline(products, {
      dryRun: options.dryRun,
      rehostImages: !options.dryRun && !options.skipImages,
      resume: options.resume && !options.dryRun,
      sellerLabel: 'Motoka',
    });
    if (runRa) await sleep(options.delayMs);
  }

  if (runRa) {
    await runRockauto(options);
  }

  if (!options.dryRun && !options.skipMerch && runAf) {
    await merchandizeLadipo({ dryRun: false });
  }

  if (!options.dryRun && !options.skipVerify) {
    try {
      await verifyLadipoCatalog({ reportOnly: options.dryRun });
    } catch (err) {
      // Coverage starts empty on a fresh project; the report still printed.
      // Don't fail the seed itself — `npm run verify:ladipo:catalog` is the gate.
      console.warn(`[seed_motoka_catalog] coverage gate: ${err.message}`);
    }
  }

  console.log('\n[seed_motoka_catalog] done');
}

main().catch((error) => {
  console.error(`[seed_motoka_catalog] Fatal: ${error.message}`);
  process.exit(1);
});
