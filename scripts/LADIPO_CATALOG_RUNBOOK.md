# Ladipo multi-source catalog — partner runbook

Branch handoff for Motoka Ladipo catalog ingest, fitment filters, and Transmission category.

## After merge / pull

### 1. Backend deps

```bash
cd motoka-backend
git pull
npm install
```

### 2. Apply Supabase migrations (required)

Apply any pending migrations through **099** on the target project (local / staging / prod):

| Migration | Purpose |
|-----------|---------|
| `054` … `071` | Existing Ladipo schema (if not already applied) |
| `072_ladipo_fitment_matching.sql` | `get_ladipo_compatible_part_ids` + make-key normalisation |
| `073_ladipo_transmission_category.sql` | **Transmission & Drivetrain** under Spare Parts |
| `099_ladipo_catalog_integrity.sql` | Re-declares merchandising flags (`is_must_have` etc.), adds idempotency constraints on compatibility/inventory, records fitment provenance |

Example (Supabase CLI linked to the project):

Apply each pending SQL file **in order** in the Supabase SQL editor (or via the
Management API). **Never run `supabase db push` against the live project** — its
migration ledger does not match reality and a push would install schema that is
deliberately kept off prod.

Env required for seed scripts:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### 3. One-time filter / category hygiene (recommended after 073)

Remaps gearboxes/drivetrain out of **Gear Oil & ATF**, inserts Transmission category if missing, deletes corrupt car-make compatibility rows:

```bash
npm run fix:ladipo:filters
# dry-run first if you want:
node scripts/fix-ladipo-filter-data.js --dry-run
```

### 4. Build the vehicle catalog reference (one-time / when make-model data changes)

The AI fitment extractor and verifier validate every claim against `scripts/data/vehicle-catalog.json`. This file is committed to the repo, so a fresh clone/pull already has it — only regenerate it if you intentionally want to refresh the NHTSA + NG reference data:

```bash
npm run build:vehicle-catalog
```

If it's ever missing, any script that needs it (`verify:ladipo:catalog`, the backfill) fails fast with `Vehicle catalog missing at ... Run: npm run build:vehicle-catalog` — that error is the signal to run this step.

### 5. Seed catalog (NG primary source)

```bash
# Preview (no DB writes)
npm run seed:motoka:catalog -- --dry-run --limit 30

# Live small batch
npm run seed:motoka:catalog -- --limit 200 --per-category 40

# Larger catalog
npm run seed:motoka:catalog -- --limit 1000 --per-category 80
```

The orchestrator is **upsert-based** (matches existing rows by `slug`/`part_id`), so re-running it is safe and will not create duplicate products.

Pipeline stages, run automatically unless skipped:
1. Crawl Autofactor NG (images, NGN prices, OEM numbers)
2. Gemini extracts fitment; verified against the vehicle catalog + OEM decoder — low-confidence rows are staged `is_active=false`, never silently published
3. Upsert into Supabase
4. Merchandising flags (`is_must_have`, `is_essential`, `is_featured`, `is_bestseller`, `is_deal`) — **re-running this reassigns all flags on active parts, so it will overwrite any manual must-have/featured toggles set from the admin UI.** Pass `--skip-merch` if you don't want that.
5. Coverage report (`--skip-verify` to skip)

Sources:

- **Default `--source all`** (or omit `--source`) = Autofactor NG only. Ladipo Market is a separate, optional importer — it is **not** invoked by the orchestrator.
- **`--with-rockauto`** = optional fitment merge only (needs Python venv below)
- **`--fresh`** = ignore the resume checkpoint (`scripts/data/pipeline-checkpoint.json`) and reprocess every slug (still upsert-safe, just slower)

⚠️ **Never pass `--sync` to `import-ladipo-autofactor.js` on a live/shared database** — that flag truncates `ladipo_parts`, `ladipo_part_inventory`, and `ladipo_part_compatibility` before reseeding.

Individual importers:

```bash
npm run import:ladipo:autofactor -- --limit 200 --per-category 50
node scripts/import-ladipo-market.js --limit 200 --per-category 50   # optional secondary source, no npm alias
npm run backfill:ladipo:compatibility -- --limit 2000
```

### 6. Optional RockAuto fitment (secondary)

```bash
python3 -m venv .venv-seed
.venv-seed/bin/pip install -r scripts/requirements-motoka-inventory.txt
.venv-seed/bin/python scripts/seed_motoka_inventory.py --enrich-fitment --limit 100
# or via orchestrator:
npm run seed:motoka:catalog -- --source rockauto --limit 100
```

RockAuto must **not** replace NG images/prices. If RockAuto rate-limits, skip it; backfill + NG catalog is enough to browse.

### 7. Frontend

```bash
cd Motoka
git pull
npm install
# restart Vite / deploy staging as usual
```

Admin products: single **Car brand** filter (Toyota, Mercedes-Benz, BMW, …) matches product name/brand.  
User marketplace: category filters use Motoka taxonomy; car picker uses compatibility RPC (072).

### 8. Sanity checks

1. Admin → Products → Car brand **BMW** → only BMW-titled products  
2. User → **Spare Parts → Transmission & Drivetrain** → gearboxes / CV axles  
3. User → **Lubricants / Fluids → Gear Oil & ATF** → fluids only (may be empty until ATF is scraped)  
4. User → select **2015 Camry** (or a make present in titles) → fitment returns matching parts  
5. `npm run verify:ladipo:catalog` → coverage report shows no unexpected spike in "published without fitment"

### 9. Do **not** commit / ship

- `.env`, service role keys  
- `.venv-seed/`  
- `supabase/.temp/`  
- Local `AdminLogin.jsx` email overrides  

## Useful npm scripts

| Script | Command |
|--------|---------|
| Catalog orchestrator | `npm run seed:motoka:catalog` |
| Autofactor import | `npm run import:ladipo:autofactor` |
| Ladipo Market import (no npm alias) | `node scripts/import-ladipo-market.js` |
| Compatibility backfill | `npm run backfill:ladipo:compatibility` |
| Filter/category fix | `npm run fix:ladipo:filters` |
| Vehicle catalog build | `npm run build:vehicle-catalog` |
| Merchandising flags only | `npm run merchandize:ladipo` |
| Catalog coverage verify | `npm run verify:ladipo:catalog` |
