import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const fmtNaira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

async function q(label, fn) {
  try {
    const r = await fn();
    console.log(`\n── ${label} ──`);
    console.log(r);
  } catch (e) {
    console.log(`\n── ${label} ── ERR: ${e.message}`);
  }
}

await q('Total payment_transactions by gateway × status (last 30d)', async () => {
  const { data, error } = await supa
    .from('payment_transactions')
    .select('payment_gateway, status')
    .gte('created_at', since);
  if (error) throw error;
  const map = new Map();
  for (const r of data) {
    const k = `${r.payment_gateway || '(null)'} / ${r.status}`;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Object.fromEntries([...map].sort());
});

await q('Monicredit txns - status breakdown (all time)', async () => {
  const { data, error } = await supa
    .from('payment_transactions')
    .select('status, amount')
    .eq('payment_gateway', 'monicredit');
  if (error) throw error;
  const agg = {};
  for (const r of data) {
    if (!agg[r.status]) agg[r.status] = { count: 0, totalKobo: 0 };
    agg[r.status].count++;
    agg[r.status].totalKobo += Number(r.amount || 0);
  }
  return Object.fromEntries(
    Object.entries(agg).map(([k, v]) => [k, { count: v.count, total: fmtNaira(v.totalKobo) }])
  );
});

await q('Pending Monicredit txns older than 1 hour (likely never paid OR webhook missed)', async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error, count } = await supa
    .from('payment_transactions')
    .select('reference, monicredit_order_id, amount, created_at, user_id', { count: 'exact' })
    .eq('payment_gateway', 'monicredit')
    .eq('status', 'pending')
    .lt('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return { count, sample: data.map(r => ({ ref: r.reference, mc_id: r.monicredit_order_id, amount: fmtNaira(r.amount), age_hrs: ((Date.now() - new Date(r.created_at).getTime()) / 3600000).toFixed(1) })) };
});

await q('Successful Monicredit txns WITHOUT a renewal_order (orphan payments)', async () => {
  const { data: txns, error } = await supa
    .from('payment_transactions')
    .select('id, reference, amount, created_at, payment_type')
    .eq('payment_gateway', 'monicredit')
    .eq('status', 'successful');
  if (error) throw error;
  const ids = txns.map(t => t.id);
  if (ids.length === 0) return { count: 0 };
  const { data: orders } = await supa
    .from('renewal_orders')
    .select('transaction_id')
    .in('transaction_id', ids);
  const linked = new Set((orders || []).map(o => o.transaction_id));
  const orphans = txns.filter(t => !linked.has(t.id));
  return { successfulMonicreditTotal: txns.length, orphans: orphans.length, sample: orphans.slice(0, 5).map(o => ({ ref: o.reference, amount: fmtNaira(o.amount), type: o.payment_type, when: o.created_at })) };
});

await q('Renewal orders by status (all time)', async () => {
  const { data, error } = await supa
    .from('renewal_orders')
    .select('status, order_type');
  if (error) throw error;
  const map = {};
  for (const r of data) {
    const k = `${r.status} / ${r.order_type}`;
    map[k] = (map[k] || 0) + 1;
  }
  return map;
});

await q('Webhook_event_id presence on successful Monicredit txns (proxy: did the webhook actually fire?)', async () => {
  const { data, error } = await supa
    .from('payment_transactions')
    .select('webhook_event_id')
    .eq('payment_gateway', 'monicredit')
    .eq('status', 'successful');
  if (error) throw error;
  const total = data.length;
  const withEvent = data.filter(r => r.webhook_event_id).length;
  return { totalSuccessfulMonicredit: total, withWebhookEventId: withEvent, withoutWebhookEventId: total - withEvent };
});

await q('Recent payment_audit_log events for Monicredit (last 50)', async () => {
  const { data, error } = await supa
    .from('payment_audit_log')
    .select('event_type, status_before, status_after, created_at')
    .eq('payment_gateway', 'monicredit')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (String(error.message).includes('does not exist')) return '(payment_audit_log table not found)';
    throw error;
  }
  const counts = {};
  for (const r of data) {
    counts[r.event_type] = (counts[r.event_type] || 0) + 1;
  }
  return { sampledRows: data.length, eventTypes: counts, mostRecent: data[0]?.created_at };
});

process.exit(0);
