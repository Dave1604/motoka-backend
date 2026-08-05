import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MonicreditAdapter } from '../src/services/payment/monicredit/index.js';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fmtNaira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { data: candidates } = await supa
  .from('payment_transactions')
  .select('id, reference, monicredit_order_id, status, amount, payment_type, created_at')
  .eq('payment_gateway', 'monicredit')
  .in('status', ['abandoned', 'failed', 'pending']);

console.log(`Verifying ${candidates.length} txns throttled at 1.5s/request (avoids rate limit)…\n`);

const buckets = { approved: [], pending: [], failed: [], unknown: [], transport_error: [] };
let i = 0;
for (const t of candidates) {
  i++;
  const lookupId = t.monicredit_order_id || t.reference;

  let retries = 0;
  let done = false;
  while (!done && retries < 3) {
    try {
      const r = await MonicreditAdapter.verifyPayment(lookupId);
      buckets[r.state].push({
        ref: t.reference, ourStatus: t.status, ourAmount: t.amount,
        monicreditStatus: r.status, monicreditAmount: r.amount,
        datePaid: r.date_paid, channel: r.channel,
        created_at: t.created_at,
      });
      done = true;
    } catch (e) {
      if (e.message?.includes('Too many attempts')) {
        const waitMatch = e.message.match(/(\d+)\s*seconds/);
        const waitSec = waitMatch ? parseInt(waitMatch[1], 10) : 60;
        process.stderr.write(`  rate-limited at ${i}/${candidates.length} — waiting ${waitSec + 2}s…\n`);
        await sleep((waitSec + 2) * 1000);
        retries++;
      } else {
        buckets.transport_error.push({ ref: t.reference, error: e.message });
        done = true;
      }
    }
  }
  if (!done) buckets.transport_error.push({ ref: t.reference, error: 'gave up after 3 retries' });

  await sleep(1500); // gentle throttle
  if (i % 10 === 0) process.stderr.write(`  ${i}/${candidates.length}\n`);
}

console.log('\n━━━━━━━━━━ Final results ━━━━━━━━━━\n');
console.log(`  ✓ Monicredit says APPROVED (real missed payments): ${buckets.approved.length}  ← MONEY-LOSS RISK`);
console.log(`  · Monicredit says PENDING (never paid)            : ${buckets.pending.length}`);
console.log(`  · Monicredit says FAILED                           : ${buckets.failed.length}`);
console.log(`  · Monicredit has no record / Invalid Transaction   : ${buckets.unknown.length}`);
console.log(`  ! Transport errors                                 : ${buckets.transport_error.length}`);

if (buckets.approved.length > 0) {
  console.log('\n━━━━━━━━━━ APPROVED txns we marked abandoned/failed (MISSED REVENUE) ━━━━━━━━━━\n');
  let total = 0;
  for (const a of buckets.approved) {
    total += Number(a.monicreditAmount || 0);
    console.log(`  ${a.ref.padEnd(28)} our:${a.ourStatus.padEnd(10)} ${fmtNaira(a.ourAmount).padStart(12)}  monicredit:${(a.monicreditStatus||'').padEnd(10)} ${fmtNaira(a.monicreditAmount).padStart(12)}  paid:${a.datePaid || '?'}`);
  }
  console.log(`\n  TOTAL MISSED REVENUE: ${fmtNaira(total)}`);
}

console.log('\n━━━━━━━━━━ Confusion matrix (our DB status × Monicredit truth) ━━━━━━━━━━\n');
const matrix = {};
for (const [state, arr] of Object.entries(buckets)) for (const r of arr) {
  const k = `${r.ourStatus} → ${state}`;
  matrix[k] = (matrix[k] || 0) + 1;
}
for (const [k, v] of Object.entries(matrix).sort()) console.log(`  ${k.padEnd(28)} : ${v}`);

process.exit(0);
