/**
 * Attach paid guest orders that predate auto-account creation (#69) to an
 * account, the same way a payment does today: link to an existing profile
 * with that email, else create a passwordless account the guest can claim.
 * Until linked, these orders sit on "Awaiting registration" in admin and the
 * sweeper never releases them.
 *
 *   node scripts/backfill-guest-accounts.js --dry-run
 *   node scripts/backfill-guest-accounts.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../src/config/supabase.js';
import { linkOrCreateGuestAccount } from '../src/services/guest/guestRenewal.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const supabase = getSupabaseAdmin();

  const { data: orders, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, guest_email, guest_name, guest_phone, plate_number, created_at')
    .eq('payment_status', 'payment_success')
    .is('linked_user_id', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  console.log(`${orders.length} paid guest order(s) with no account${dryRun ? ' (dry run)' : ''}`);
  for (const order of orders) {
    const label = `${order.created_at.slice(0, 10)} ${order.guest_email} ${order.plate_number}`;
    if (dryRun) {
      const { data: existing } = await supabase
        .from('profiles').select('id').eq('email', order.guest_email.toLowerCase()).maybeSingle();
      console.log(`  ${label} -> would ${existing ? `link to ${existing.id}` : 'create account'}`);
      continue;
    }
    const { userId, created } = await linkOrCreateGuestAccount(supabase, order);
    console.log(`  ${label} -> ${userId ? `${created ? 'created' : 'linked'} ${userId}` : 'FAILED (see log)'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
