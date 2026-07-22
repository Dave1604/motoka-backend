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

Apply any pending migrations through **073** on the target project (local / staging / prod):

| Migration | Purpose |
|-----------|---------|
| `054` … `071` | Existing Ladipo schema (if not already applied) |
| `072_ladipo_fitment_matching.sql` | `get_ladipo_compatible_part_ids` + make-key normalisation |
| `073_ladipo_transmission_category.sql` | **Transmission & Drivetrain** under Spare Parts |

Example (Supabase CLI linked to the project):

```bash
supabase db push
# or apply SQL files in order in the Supabase SQL editor
```

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

### 4. Seed catalog (NG primary sources)

```bash
# Preview
npm run seed:motoka:catalog -- --dry-run --limit 30

# Live small batch
npm run seed:motoka:catalog -- --source all --limit 200 --per-category 40 --with-backfill

# Larger catalog
npm run seed:motoka:catalog -- --source all --limit 1000 --per-category 80 --with-backfill
```

Sources:

- **Default `--source all`** = Autofactor NG + Ladipo Market (images + NGN + Motoka categories)
- **`--with-rockauto`** = optional Camry/C300 fitment merge only (needs Python venv below)
- **`--with-backfill`** = title-inferred make/model/year for rows missing fitment

Individual importers:

```bash
npm run import:ladipo:autofactor -- --limit 200 --per-category 50
npm run import:ladipo:market -- --limit 200 --per-category 50
npm run backfill:ladipo:compatibility -- --source all --limit 2000
```

### 5. Optional RockAuto fitment (secondary)

```bash
python3 -m venv .venv-seed
.venv-seed/bin/pip install -r scripts/requirements-motoka-inventory.txt
.venv-seed/bin/python scripts/seed_motoka_inventory.py --enrich-fitment --limit 100
# or via orchestrator:
npm run seed:motoka:catalog -- --source rockauto --limit 100
```

RockAuto must **not** replace NG images/prices. If RockAuto rate-limits, skip it; backfill + NG catalog is enough to browse.

### 6. Frontend

```bash
cd Motoka
git pull
npm install
# restart Vite / deploy staging as usual
```

Admin products: single **Car brand** filter (Toyota, Mercedes-Benz, BMW, …) matches product name/brand.  
User marketplace: category filters use Motoka taxonomy; car picker uses compatibility RPC (072).

### 7. Sanity checks

1. Admin → Products → Car brand **BMW** → only BMW-titled products  
2. User → **Spare Parts → Transmission & Drivetrain** → gearboxes / CV axles  
3. User → **Lubricants / Fluids → Gear Oil & ATF** → fluids only (may be empty until ATF is scraped)  
4. User → select **2015 Camry** (or a make present in titles) → fitment returns matching parts  

### 8. Do **not** commit / ship

- `.env`, service role keys  
- `.venv-seed/`  
- `supabase/.temp/`  
- Local `AdminLogin.jsx` email overrides  

## Useful npm scripts

| Script | Command |
|--------|---------|
| Catalog orchestrator | `npm run seed:motoka:catalog` |
| Autofactor import | `npm run import:ladipo:autofactor` |
| Ladipo Market import | `npm run import:ladipo:market` |
| Compatibility backfill | `npm run backfill:ladipo:compatibility` |
| Filter/category fix | `npm run fix:ladipo:filters` |
