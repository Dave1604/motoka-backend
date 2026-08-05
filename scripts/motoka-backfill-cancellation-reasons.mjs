import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// 1. Verify the column exists (migration 064). Bail with clear error otherwise.
{
  const { error } = await supa
    .from('payment_transactions')
    .select('cancellation_reason')
    .limit(1);
  if (error?.message?.includes('cancellation_reason')) {
    console.error('ERROR: cancellation_reason column missing. Apply migration 064 first.');
    console.error('  Path: supabase/migrations/064_payment_cancellation_reason.sql');
    process.exit(1);
  }
}

// 2. Pull every abandoned/failed row that DOESN'T already have a reason.
const { data: rows, error } = await supa
  .from('payment_transactions')
  .select('id, reference, user_id, car_id, payment_type, payment_gateway, status, monicredit_order_id, paystack_reference, created_at, cancellation_reason')
  .in('status', ['abandoned', 'failed'])
  .is('cancellation_reason', null)
  .order('created_at', { ascending: true });
if (error) { console.error(error.message); process.exit(1); }

console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: classifying ${rows.length} untagged abandoned/failed rows.\n`);

// 3. Group by (user_id, car_id ?? 'nocar', payment_type) so we can detect bursts.
//    A burst is: ≥2 rows in the same group with consecutive gaps ≤30 minutes.
const groups = new Map();
for (const r of rows) {
  const key = `${r.user_id}|${r.car_id ?? 'nocar'}|${r.payment_type || 'unknown'}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

// Mark rows that are part of a burst — they're likely duplicate_init.
const inBurst = new Set();
for (const [, arr] of groups) {
  for (let i = 0; i < arr.length; i++) {
    const cur = arr[i];
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const gapPrev = prev ? (new Date(cur.created_at) - new Date(prev.created_at)) / 60000 : Infinity;
    const gapNext = next ? (new Date(next.created_at) - new Date(cur.created_at)) / 60000 : Infinity;
    if (gapPrev <= 30 || gapNext <= 30) inBurst.add(cur.id);
  }
}

// 4. Decide reason per row.
const classifications = { duplicate_init: [], user_abandoned: [], gateway_failure: [] };
for (const r of rows) {
  const hasGatewayRef = !!(r.monicredit_order_id || r.paystack_reference);
  let reason;
  if (inBurst.has(r.id)) {
    // Multiple rapid attempts on the same logical purchase — the abandon
    // came from a re-init, not a real customer drop-off.
    reason = 'duplicate_init';
  } else if (!hasGatewayRef) {
    // Init never reached the gateway (no reference stored). Treat as a
    // gateway-side or network failure.
    reason = 'gateway_failure';
  } else if (r.status === 'failed') {
    // Status='failed' on a row that DID reach the gateway and isn't in a
    // burst — most likely an explicit admin "Mark Failed" or a real gateway
    // decline.
    reason = 'gateway_failure';
  } else {
    // Isolated abandoned txn with a gateway reference — customer started, got
    // a virtual account, then gave up.
    reason = 'user_abandoned';
  }
  classifications[reason].push(r);
}

console.log('Classification:');
for (const [reason, arr] of Object.entries(classifications)) {
  console.log(`  ${reason.padEnd(18)} ${arr.length.toString().padStart(4)}  rows`);
}
console.log(`  TOTAL              ${rows.length.toString().padStart(4)}\n`);

if (!APPLY) {
  console.log('Re-run with --apply to write these to the DB. No changes made.');
  process.exit(0);
}

// 5. Write in 3 batched UPDATE-IN-LIST calls.
let updated = 0;
for (const [reason, arr] of Object.entries(classifications)) {
  if (arr.length === 0) continue;
  const ids = arr.map(r => r.id);
  const { data, error: err } = await supa
    .from('payment_transactions')
    .update({ cancellation_reason: reason })
    .in('id', ids)
    .select('id');
  if (err) {
    console.error(`Failed to write reason='${reason}':`, err.message);
    continue;
  }
  updated += data?.length || 0;
  console.log(`  wrote ${reason}: ${data?.length || 0} rows`);
}

console.log(`\nDone. ${updated} / ${rows.length} rows tagged.`);
process.exit(0);
