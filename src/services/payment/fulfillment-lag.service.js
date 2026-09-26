import { getSupabaseAdmin } from '../../config/supabase.js';
import { listTransactions as paystackListTransactions } from './paystack.service.js';
import { REFERENCE_PREFIX } from '../../constants/payment.constants.js';
import { logWarn } from '../../utils/logger.js';

// Fulfillment-lag watch: finds money or orders stuck between "paid" and
// "processed". Three local checks run on every call (cheap indexed queries);
// the Paystack reconciliation sweep only runs on demand (?reconcile=true)
// because it pages an external API.
//
// Check 1 — orphan successes: payment_transactions marked successful but
// with no renewal_orders row (fulfillment crashed mid-way). Grace period
// keeps webhook/verify races from flagging.
// Check 2 — stale pipeline orders: pending/processing orders older than
// their thresholds (papers possibly never touched).
// Check 3 — stale guest payments: guest_renewal_orders sitting at
// payment_success past the processing SLA (guest flow has no completed
// state, so age is the only signal).
// Check 4 (on demand) — ghost money: Paystack successes carrying OUR
// reference prefix with no local row anywhere (init never persisted,
// wrong DB, or keys mismatch). This is the "money on Paystack, nothing in
// admin" case.

const MS_PER_HOUR = 3600 * 1000;

function ageHours(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round((ms / MS_PER_HOUR) * 10) / 10;
}

function cutoffIso({ minutes = 0, hours = 0, days = 0 } = {}) {
  return new Date(Date.now() - (minutes / 60 + hours + days * 24) * MS_PER_HOUR).toISOString();
}

async function findOrphanSuccesses(supabase, graceMinutes) {
  const { data: paid, error } = await supabase
    .from('payment_transactions')
    .select('id, reference, amount, paid_at')
    .eq('status', 'successful')
    .lt('paid_at', cutoffIso({ minutes: graceMinutes }))
    .order('paid_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  if (!paid?.length) return [];

  const ids = paid.map((t) => t.id);
  const { data: linked, error: linkError } = await supabase
    .from('renewal_orders')
    .select('transaction_id')
    .in('transaction_id', ids);
  if (linkError) throw linkError;

  const linkedIds = new Set((linked || []).map((o) => o.transaction_id));
  return paid
    .filter((t) => !linkedIds.has(t.id))
    .map((t) => ({
      transaction_id: t.id,
      reference: t.reference,
      amount_kobo: Number(t.amount) || 0,
      paid_at: t.paid_at,
      age_hours: ageHours(t.paid_at),
    }));
}

async function findStaleOrders(supabase, pendingHours, processingHours) {
  const { data: orders, error } = await supabase
    .from('renewal_orders')
    .select('id, order_number, status, created_at, processing_started_at, amount_paid')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  const staleNew = [];
  const stalled = [];
  for (const o of orders || []) {
    if (o.status === 'pending') {
      const age = ageHours(o.created_at);
      if (age !== null && age >= pendingHours) {
        staleNew.push({
          order_id: o.id,
          order_number: o.order_number,
          amount_paid: o.amount_paid,
          created_at: o.created_at,
          age_hours: age,
        });
      }
    } else {
      const since = o.processing_started_at || o.created_at;
      const age = ageHours(since);
      if (age !== null && age >= processingHours) {
        stalled.push({
          order_id: o.id,
          order_number: o.order_number,
          amount_paid: o.amount_paid,
          processing_since: since,
          age_hours: age,
        });
      }
    }
  }
  return { staleNew, stalled };
}

async function findStaleGuestPayments(supabase, guestHours) {
  const { data: guests, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, guest_name, guest_email, plate_number, total_amount, payment_reference, updated_at')
    .eq('payment_status', 'payment_success')
    .lt('updated_at', cutoffIso({ hours: guestHours }))
    .order('updated_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (guests || []).map((g) => ({
    order_id: g.id,
    guest_name: g.guest_name,
    guest_email: g.guest_email,
    plate_number: g.plate_number,
    total_amount_kobo: Number(g.total_amount) || 0,
    payment_reference: g.payment_reference,
    paid_at: g.updated_at,
    age_hours: ageHours(g.updated_at),
  }));
}

async function findGhostMoney(supabase, reconDays) {
  const prefix = `${REFERENCE_PREFIX.PAYMENT}-`;
  const from = new Date(Date.now() - reconDays * 24 * MS_PER_HOUR).toISOString().slice(0, 10);

  // Page Paystack successes (bounded: latest window, max 6 pages).
  const paystackRefs = new Map();
  let page = 1;
  for (;;) {
    const { transactions, meta } = await paystackListTransactions({
      status: 'success',
      from,
      perPage: 50,
      page,
    });
    for (const t of transactions || []) {
      if (typeof t?.reference === 'string' && t.reference.startsWith(prefix)) {
        paystackRefs.set(t.reference, {
          reference: t.reference,
          amount_kobo: Number(t.amount) || 0,
          customer_email: t.customer?.email || null,
          paid_at: t.paid_at || t.paidAt || null,
        });
      }
    }
    const pageCount = Number(meta?.pageCount) || 1;
    if (page >= pageCount || page >= 6) break;
    page += 1;
  }
  if (paystackRefs.size === 0) return [];

  const refs = [...paystackRefs.keys()];
  const { data: localTxns, error: txnError } = await supabase
    .from('payment_transactions')
    .select('reference')
    .in('reference', refs);
  if (txnError) throw txnError;
  const { data: localGuests, error: guestError } = await supabase
    .from('guest_renewal_orders')
    .select('payment_reference')
    .in('payment_reference', refs);
  if (guestError) throw guestError;

  const known = new Set([
    ...((localTxns || []).map((t) => t.reference)),
    ...((localGuests || []).map((g) => g.payment_reference)),
  ]);
  return refs
    .filter((r) => !known.has(r))
    .map((r) => ({ ...paystackRefs.get(r), age_hours: ageHours(paystackRefs.get(r).paid_at) }));
}

export async function checkFulfillmentLag({
  orphanGraceMinutes = 30,
  pendingOrderHours = 24,
  processingOrderHours = 48,
  guestStaleHours = 24,
  reconcile = false,
  reconDays = 7,
} = {}) {
  const supabase = getSupabaseAdmin();
  const [orphans, pipeline, staleGuests] = await Promise.all([
    findOrphanSuccesses(supabase, orphanGraceMinutes),
    findStaleOrders(supabase, pendingOrderHours, processingOrderHours),
    findStaleGuestPayments(supabase, guestStaleHours),
  ]);

  let ghosts = [];
  if (reconcile) {
    try {
      ghosts = await findGhostMoney(supabase, reconDays);
    } catch (err) {
      // Paystack sweep is best-effort: report the failure, keep the local checks.
      logWarn('[FulfillmentLag] Paystack reconciliation failed', { error: err?.message });
      ghosts = [{ error: 'paystack_reconciliation_failed' }];
    }
  }

  const counts = {
    orphan_successes: orphans.length,
    stale_new_orders: pipeline.staleNew.length,
    stalled_processing: pipeline.stalled.length,
    stale_guest_payments: staleGuests.length,
    ghost_money: ghosts.length,
  };
  return {
    generated_at: new Date().toISOString(),
    reconciled_with_paystack: Boolean(reconcile),
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    orphan_successes: orphans,
    stale_new_orders: pipeline.staleNew,
    stalled_processing: pipeline.stalled,
    stale_guest_payments: staleGuests,
    ghost_money: ghosts,
  };
}
