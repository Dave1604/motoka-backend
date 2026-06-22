import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MonicreditAdapter } from '../src/services/payment/monicredit/index.js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const fmtNaira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const { data: pendings, error } = await supa
  .from('payment_transactions')
  .select('id, reference, monicredit_order_id, amount, created_at, user_id, payment_type, car_id, metadata')
  .eq('payment_gateway', 'monicredit')
  .eq('status', 'pending')
  .lt('created_at', oneHourAgo)
  .order('created_at', { ascending: false });

if (error) {
  console.error('DB error:', error.message);
  process.exit(1);
}

console.log(`Found ${pendings.length} stale pending Monicredit txns. Verifying each…\n`);

const results = [];
for (const t of pendings) {
  const lookupId = t.monicredit_order_id || t.reference;
  let row = {
    ref: t.reference,
    amount: fmtNaira(t.amount),
    type: t.payment_type,
    age_hrs: ((Date.now() - new Date(t.created_at).getTime()) / 3600000).toFixed(1),
    lookupId,
  };
  try {
    const r = await MonicreditAdapter.verifyPayment(lookupId);
    row.monicredit_status = r.status || '(none)';
    row.amount_returned = r.amount != null ? fmtNaira(r.amount) : '—';
    row.channel = r.channel || '—';
    row.date_paid = r.date_paid || '—';
    row.raw_envelope_status = r.raw_response?.status ?? '(none)';
    row.verdict = (r.status === 'approved' || r.status === 'success' || r.raw_response?.status === true || r.raw_response?.status === 'success')
      ? '🟢 POSSIBLE MISSED PAYMENT — needs recovery'
      : '⚪ not paid';
  } catch (e) {
    row.monicredit_status = 'ERROR';
    row.error = e.message;
    row.verdict = '⚠ verify call failed';
  }
  results.push(row);
}

console.table(results.map(r => ({
  ref: r.ref,
  amount: r.amount,
  age_hrs: r.age_hrs,
  monicredit_status: r.monicredit_status,
  amount_returned: r.amount_returned,
  verdict: r.verdict,
})));

const missed = results.filter(r => r.verdict.startsWith('🟢'));
console.log(`\n${missed.length} of ${results.length} need recovery.`);
if (missed.length) {
  console.log('\nDetails of suspected missed payments:');
  for (const m of missed) console.log(JSON.stringify(m, null, 2));
}

process.exit(0);
