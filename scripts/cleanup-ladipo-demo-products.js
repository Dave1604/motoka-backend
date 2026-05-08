import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSupabaseAdmin } from '../src/config/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

async function main() {
  const supabase = getSupabaseAdmin();
  const chunkSize = 200;
  let totalRemoved = 0;

  while (true) {
    const { data: demoParts, error: partsError } = await supabase
      .from('ladipo_parts')
      .select('id, sku')
      .like('sku', 'LDP-%')
      .limit(chunkSize);

    if (partsError) {
      throw new Error(`Failed to query demo products: ${partsError.message}`);
    }

    if (!demoParts || demoParts.length === 0) {
      break;
    }

    const ids = demoParts.map((row) => row.id);
    console.log(`[cleanup-ladipo] Removing batch of ${ids.length} demo products...`);

    const { error: compatibilityError } = await supabase
      .from('ladipo_part_compatibility')
      .delete()
      .in('part_id', ids);
    if (compatibilityError) {
      const msg = String(compatibilityError.message || '').toLowerCase();
      if (!msg.includes('does not exist') && !msg.includes('bad request')) {
        throw new Error(`Failed to delete compatibility rows: ${compatibilityError.message}`);
      }
    }

    const { error: inventoryError } = await supabase
      .from('ladipo_part_inventory')
      .delete()
      .in('part_id', ids);
    if (inventoryError) {
      throw new Error(`Failed to delete inventory rows: ${inventoryError.message}`);
    }

    const { error: partsDeleteError } = await supabase
      .from('ladipo_parts')
      .delete()
      .in('id', ids);
    if (partsDeleteError) {
      throw new Error(`Failed to delete demo products: ${partsDeleteError.message}`);
    }

    totalRemoved += ids.length;
  }

  if (totalRemoved === 0) {
    console.log('[cleanup-ladipo] No demo products found. Nothing to remove.');
    return;
  }

  console.log(`[cleanup-ladipo] Removed ${totalRemoved} demo products successfully.`);
}

main().catch((error) => {
  console.error(`[cleanup-ladipo] Fatal error: ${error.message}`);
  process.exit(1);
});
