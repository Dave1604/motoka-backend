/**
 * DEPRECATED — replaced by scripts/seed_motoka_inventory.py
 *
 * The Autofactor HTML/JSON crawler has been cleared. Motoka inventory
 * ingestion now uses the RockAuto open-source client (rockauto-api) with
 * NGN pricing localization and direct Supabase upserts into:
 *   ladipo_parts / ladipo_part_inventory / ladipo_part_compatibility
 *
 * Run:
 *   python3 -m venv .venv-seed
 *   .venv-seed/bin/pip install -r scripts/requirements-motoka-inventory.txt
 *   .venv-seed/bin/python scripts/seed_motoka_inventory.py --dry-run
 */

console.error(
  '[import-autofactor] Deprecated. Use scripts/seed_motoka_inventory.py instead.'
);
process.exit(1);
