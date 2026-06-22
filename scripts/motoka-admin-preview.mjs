import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const fmtNaira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

const headCount = (filterFn) => {
  let q = supa.from('payment_transactions').select('id', { count: 'exact', head: true });
  if (filterFn) q = filterFn(q);
  return q;
};
const [
  totalRes, succRes, pendRes, failedRes, abandonedRes, paystackRes, monicreditRes,
  successAmtsRes, pendingAmtsRes
] = await Promise.all([
  headCount(),
  headCount(q => q.eq('status', 'successful')),
  headCount(q => q.eq('status', 'pending')),
  headCount(q => q.eq('status', 'failed')),
  headCount(q => q.eq('status', 'abandoned')),
  headCount(q => q.eq('payment_gateway', 'paystack')),
  headCount(q => q.eq('payment_gateway', 'monicredit')),
  supa.from('payment_transactions').select('amount').eq('status', 'successful'),
  supa.from('payment_transactions').select('amount').eq('status', 'pending'),
]);

const sumKobo = (rows) => (rows || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0);
const receivedKobo = sumKobo(successAmtsRes.data);
const pendingKobo = sumKobo(pendingAmtsRes.data);

console.log('\n━━━━━━━━━━ ADMIN PAYMENTS PAGE PREVIEW ━━━━━━━━━━\n');
console.log('  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐');
console.log(`  │  Received   │ │   Pending   │ │ Failed/Abandoned │`);
console.log(`  │ ${fmtNaira(receivedKobo).padEnd(11)} │ │ ${fmtNaira(pendingKobo).padEnd(11)} │ │ ${String((failedRes.count || 0) + (abandonedRes.count || 0)).padEnd(15)} │`);
console.log(`  │ ${String(succRes.count || 0).padEnd(2)} successful │ │ ${String(pendRes.count || 0).padEnd(2)} awaiting   │ │ ${String(failedRes.count || 0).padEnd(2)} failed · ${String(abandonedRes.count || 0).padEnd(2)} abnd │`);
console.log('  └─────────────┘ └─────────────┘ └─────────────────┘');
console.log('\n  Gateway breakdown:');
console.log(`    Monicredit: ${monicreditRes.count || 0} txns`);
console.log(`    Paystack:   ${paystackRes.count || 0} txns`);

console.log('\n━━━━━━━━━━ ADMIN ORDERS PAGE PREVIEW ━━━━━━━━━━\n');
const { data: orders } = await supa
  .from('renewal_orders')
  .select('status, order_type');

const counts = {};
for (const o of orders) {
  counts[o.status] = (counts[o.status] || 0) + 1;
}
const LABEL = { pending: 'New', processing: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' };
console.log('  Filter chip counts:');
for (const status of ['pending', 'processing', 'completed', 'cancelled']) {
  console.log(`    ${LABEL[status].padEnd(13)} (canonical "${status}") → ${counts[status] || 0}`);
}
console.log(`  Total orders: ${orders.length}`);

console.log('\n━━━━━━━━━━ POLLER WATCHLIST ━━━━━━━━━━\n');
const { count: livePendingMonicredit } = await supa
  .from('payment_transactions')
  .select('id', { count: 'exact', head: true })
  .eq('payment_gateway', 'monicredit')
  .eq('status', 'pending')
  .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
console.log(`  Monicredit pending txns < 24h old (poller will pick these up): ${livePendingMonicredit || 0}`);

process.exit(0);
