import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MonicreditAdapter } from '../src/services/payment/monicredit/index.js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const fmtNaira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// All Monicredit txns we haven't credited — these are the "did anyone actually pay?" candidates.
const { data: candidates, error } = await supa
  .from('payment_transactions')
  .select('id, reference, monicredit_order_id, status, amount, payment_type, car_id, user_id, created_at, paid_at')
  .eq('payment_gateway', 'monicredit')
  .in('status', ['abandoned', 'failed', 'pending'])
  .order('created_at', { ascending: false });

if (error) { console.error(error.message); process.exit(1); }
console.log(`Verifying ${candidates.length} non-successful Monicredit txns against Monicredit API…\n`);

const buckets = { approved: [], pending: [], failed: [], unknown: [], transport_error: [] };
let i = 0;
for (const t of candidates) {
  i++;
  if (i % 10 === 0) process.stderr.write(`  ${i}/${candidates.length}…\n`);
  const lookupId = t.monicredit_order_id || t.reference;
  try {
    const r = await MonicreditAdapter.verifyPayment(lookupId);
    buckets[r.state].push({
      ref: t.reference, ourStatus: t.status, ourAmount: t.amount,
      monicreditStatus: r.status, monicreditAmount: r.amount,
      datePaid: r.date_paid, channel: r.channel, paymentType: t.payment_type,
      created_at: t.created_at,
    });
  } catch (e) {
    buckets.transport_error.push({ ref: t.reference, error: e.message });
  }
}

console.log('\n━━━━━━━━━━ Results ━━━━━━━━━━\n');
console.log(`  ✓ Monicredit says APPROVED (real missed payments): ${buckets.approved.length}  ← MONEY-LOSS RISK`);
console.log(`  · Monicredit says PENDING (never paid)           : ${buckets.pending.length}`);
console.log(`  · Monicredit says FAILED                          : ${buckets.failed.length}`);
console.log(`  · Monicredit has no record / "Invalid Transaction": ${buckets.unknown.length}`);
console.log(`  ! Transport errors                                : ${buckets.transport_error.length}`);

if (buckets.approved.length > 0) {
  console.log('\n━━━━━━━━━━ APPROVED txns we marked abandoned/failed (MISSED REVENUE) ━━━━━━━━━━\n');
  let total = 0;
  for (const a of buckets.approved) {
    total += Number(a.monicreditAmount || 0);
    console.log(`  ${a.ref.padEnd(28)} our:${a.ourStatus.padEnd(9)} ${fmtNaira(a.ourAmount)}  monicredit:${(a.monicreditStatus||'').padEnd(9)} ${fmtNaira(a.monicreditAmount)}  paid:${a.datePaid || '?'}`);
  }
  console.log(`\n  TOTAL MISSED REVENUE: ${fmtNaira(total)}`);
}

if (buckets.transport_error.length > 0) {
  console.log('\n━━━━━━━━━━ Transport errors (retry-worthy) ━━━━━━━━━━\n');
  for (const e of buckets.transport_error.slice(0, 5)) console.log(`  ${e.ref}: ${e.error}`);
}

// Summary by ourStatus → monicreditState
console.log('\n━━━━━━━━━━ Confusion matrix (our DB status × Monicredit truth) ━━━━━━━━━━\n');
const matrix = {};
for (const [state, arr] of Object.entries(buckets)) {
  for (const r of arr) {
    if (!r.ourStatus) continue;
    const k = `${r.ourStatus} → ${state}`;
    matrix[k] = (matrix[k] || 0) + 1;
  }
}
for (const [k, v] of Object.entries(matrix).sort()) console.log(`  ${k.padEnd(28)} : ${v}`);

process.exit(0);
