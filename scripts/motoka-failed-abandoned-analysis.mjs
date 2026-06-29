import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const fmtNaira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

console.log('━━━━━━━━━━ 1) Per-gateway status breakdown ━━━━━━━━━━\n');
const { data: all } = await supa
  .from('payment_transactions')
  .select('payment_gateway, status');
const byGateway = {};
for (const t of all || []) {
  const g = t.payment_gateway || '(null)';
  if (!byGateway[g]) byGateway[g] = { total: 0, successful: 0, pending: 0, abandoned: 0, failed: 0 };
  byGateway[g].total++;
  if (byGateway[g][t.status] !== undefined) byGateway[g][t.status]++;
}
for (const [g, counts] of Object.entries(byGateway)) {
  const succRate = counts.total > 0 ? (counts.successful / counts.total * 100).toFixed(1) : '0';
  console.log(`  ${g.padEnd(12)} total=${counts.total.toString().padStart(4)}  succ=${counts.successful.toString().padStart(3)} (${succRate}%)  pending=${counts.pending.toString().padStart(3)}  abandoned=${counts.abandoned.toString().padStart(3)}  failed=${counts.failed.toString().padStart(3)}`);
}

console.log('\n━━━━━━━━━━ 2) Double-init hypothesis: do users have clusters of attempts? ━━━━━━━━━━\n');
// Group abandoned + failed + successful by (user_id, car_id) and look at burst patterns.
const { data: ab } = await supa
  .from('payment_transactions')
  .select('id, user_id, car_id, payment_gateway, payment_type, status, amount, created_at')
  .in('status', ['abandoned', 'failed', 'successful'])
  .order('created_at', { ascending: true });

const clusters = new Map();
for (const t of ab || []) {
  const key = `${t.user_id}|${t.car_id ?? 'nocar'}|${t.payment_type || 'unknown'}`;
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push(t);
}

const burstStats = { totalClusters: 0, withMultiple: 0, withDoublePay: 0, totalAbandonedInBursts: 0, totalAbandonedNotInBursts: 0, twoPaySuccessful: 0 };
const sampleBursts = [];
for (const [key, txns] of clusters) {
  burstStats.totalClusters++;
  if (txns.length < 2) continue;
  // Find sequential pairs created within 30 minutes of each other
  let hasBurst = false;
  let burstSize = 1;
  for (let i = 1; i < txns.length; i++) {
    const gapMin = (new Date(txns[i].created_at).getTime() - new Date(txns[i - 1].created_at).getTime()) / 60000;
    if (gapMin <= 30) { hasBurst = true; burstSize++; }
  }
  if (hasBurst) {
    burstStats.withMultiple++;
    const successfulInBurst = txns.filter(t => t.status === 'successful').length;
    if (successfulInBurst >= 2) burstStats.twoPaySuccessful++;
    if (successfulInBurst >= 1 && txns.some(t => t.status === 'abandoned')) burstStats.withDoublePay++;
    for (const t of txns) {
      if (t.status === 'abandoned') burstStats.totalAbandonedInBursts++;
    }
    if (sampleBursts.length < 5) {
      sampleBursts.push({ key: key.slice(0, 50), txns: txns.map(t => `${t.status}@${t.created_at.slice(11, 19)} ${fmtNaira(t.amount)} [${t.payment_gateway || '?'}]`) });
    }
  } else {
    for (const t of txns) if (t.status === 'abandoned') burstStats.totalAbandonedNotInBursts++;
  }
}
console.log(`  Total distinct (user, car, type) clusters     : ${burstStats.totalClusters}`);
console.log(`  Clusters with multiple attempts ≤30 min apart : ${burstStats.withMultiple}  ← double-init hypothesis target`);
console.log(`  Of those, ones with abandoned + successful    : ${burstStats.withDoublePay}`);
console.log(`  Clusters with 2+ SUCCESSFUL txns (potential double-credit) : ${burstStats.twoPaySuccessful}`);
console.log(`  Abandoned txns inside such bursts             : ${burstStats.totalAbandonedInBursts}  ← these are the "click twice" abandoned`);
console.log(`  Abandoned txns NOT in bursts (genuine drop-off): ${burstStats.totalAbandonedNotInBursts}`);
console.log('\n  Sample bursts:');
for (const b of sampleBursts) {
  console.log(`    ${b.key}`);
  for (const t of b.txns) console.log(`      ${t}`);
}

console.log('\n━━━━━━━━━━ 3) "Fake" abandoned/failed: which transactions actually have associated user actions? ━━━━━━━━━━\n');
// Heuristic: a "fake" abandoned/failed has no monicredit_order_id (init never reached Monicredit) OR a paystack_reference of null AND no audit log entry beyond init
const { data: af } = await supa
  .from('payment_transactions')
  .select('id, status, payment_gateway, monicredit_order_id, paystack_reference, amount, created_at')
  .in('status', ['abandoned', 'failed']);
const noGatewayRef = { abandoned: 0, failed: 0 };
const withGatewayRef = { abandoned: 0, failed: 0 };
for (const t of af || []) {
  const hasRef = (t.monicredit_order_id || t.paystack_reference);
  if (hasRef) withGatewayRef[t.status]++;
  else noGatewayRef[t.status]++;
}
console.log(`  Abandoned with gateway reference (likely real)   : ${withGatewayRef.abandoned}`);
console.log(`  Abandoned with NO gateway reference (init failed before reaching gateway) : ${noGatewayRef.abandoned}`);
console.log(`  Failed with gateway reference                    : ${withGatewayRef.failed}`);
console.log(`  Failed with NO gateway reference                 : ${noGatewayRef.failed}`);

console.log('\n━━━━━━━━━━ 4) Paystack health check ━━━━━━━━━━\n');
const { data: paystack } = await supa
  .from('payment_transactions')
  .select('reference, status, channel, paid_at, amount, created_at')
  .eq('payment_gateway', 'paystack')
  .order('created_at', { ascending: false })
  .limit(20);
const ps = byGateway.paystack || { total: 0, successful: 0, abandoned: 0, failed: 0, pending: 0 };
const psRate = ps.total > 0 ? (ps.successful / ps.total * 100).toFixed(1) : '0';
console.log(`  Paystack lifetime: total=${ps.total}  successful=${ps.successful} (${psRate}%)  failed=${ps.failed}  abandoned=${ps.abandoned}  pending=${ps.pending}`);
console.log(`  Most recent successful Paystack: ${(paystack || []).find(p => p.status === 'successful')?.created_at?.slice(0, 19) || 'NEVER'}`);
console.log(`  Most recent Paystack txn at all : ${paystack?.[0]?.created_at?.slice(0, 19) || 'none'}`);

console.log('\n━━━━━━━━━━ 5) Recent failure timeline (last 14 days) ━━━━━━━━━━\n');
const twoWeeksAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
const { data: recent } = await supa
  .from('payment_transactions')
  .select('payment_gateway, status, created_at')
  .gte('created_at', twoWeeksAgo);
const recentBy = {};
for (const t of recent || []) {
  const k = `${t.payment_gateway || '?'} / ${t.status}`;
  recentBy[k] = (recentBy[k] || 0) + 1;
}
for (const [k, v] of Object.entries(recentBy).sort()) {
  console.log(`  ${k.padEnd(28)} : ${v}`);
}

process.exit(0);
