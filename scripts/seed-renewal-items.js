/**
 * Seed Renewal Items
 *
 * Inserts the current renewal item price list into the renewal_items table.
 * Safe to re-run — uses upsert so existing rows are updated, not duplicated.
 *
 * Usage:
 *   node scripts/seed-renewal-items.js
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import { getSupabaseAdmin } from '../src/config/supabase.js';

// Prices in kobo (1 Naira = 100 kobo)
const RENEWAL_ITEMS = [
  { item_key: 'vehicle_licence',  name: 'Vehicle Licence',           price: 500000,  required: false, active: true },
  { item_key: 'road_worthiness',  name: 'Road Worthiness + Referral',price: 1150000, required: false, active: true },
  { item_key: 'insurance',        name: 'Insurance',                  price: 1500000, required: false, active: true },
  { item_key: 'proof_of_ownership', name: 'Proof of Ownership',      price: 300000,  required: false, active: true },
  { item_key: 'hackney_permit',   name: 'Hackney Permit',             price: 400000,  required: false, active: true },
  { item_key: 'digital_copy',     name: 'Keeping Digital Copy',       price: 0,       required: false, active: true },
  { item_key: 'referral',         name: 'Referral',                   price: 329000,  required: false, active: false },
];

async function seedRenewalItems() {
  console.log('🌱 Seeding renewal_items table...\n');

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('renewal_items')
    .upsert(RENEWAL_ITEMS, { onConflict: 'item_key' })
    .select('item_key, name, price, required, active');

  if (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }

  console.log(`✅ Seeded ${data.length} renewal items:\n`);
  data.forEach((item) => {
    const naira = (item.price / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const status = item.active ? '🟢 active' : '🔴 inactive';
    console.log(`  ${status}  ${item.item_key.padEnd(22)} ₦${naira.padStart(12)}  ${item.required ? '(required)' : ''}`);
  });

  console.log('\nDone.');
}

seedRenewalItems();
