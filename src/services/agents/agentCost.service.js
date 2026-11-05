import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';

export const DEFAULT_COST_STATE = 'default';

// Customers don't pay for these and agents have nothing to do for them, so they
// cost ₦0 in every state and never hold up a payout waiting for a price.
const FREE_RENEWAL_ITEMS = new Set(['digital_copy']);

/**
 * Which state's agents and costs apply to an order. renewal_state is what the
 * customer chose. Plate and licence orders have none, so they fall back to the
 * delivery state, which is stored as a 2-letter code on regular orders.
 * Returns null when the order has no state at all.
 */
export async function resolveOrderState({ order }) {
  const chosen = order.renewal_state || order.metadata?.renewal_state;
  if (chosen && String(chosen).trim()) return String(chosen).trim();

  const delivery = order.delivery_state
    || order.delivery_details?.state
    || order.metadata?.delivery_details?.state;
  if (!delivery || !String(delivery).trim()) return null;

  const value = String(delivery).trim();
  if (value.length !== 2) return value;

  const { data, error } = await getSupabaseAdmin()
    .from('states')
    .select('name')
    .eq('code', value.toUpperCase())
    .maybeSingle();
  if (error) logError('[AgentCost] Failed to resolve state code', { code: value, error: error.message });
  return data?.name || null;
}

/**
 * What the customer actually paid for the service, in kobo, excluding delivery.
 * Read from the order rather than the price table: prices change, and this is
 * the money Motoka really received. Capped at paid-minus-delivery because
 * renewal_amount falls back to the full transaction amount when it was not set.
 */
export function orderServiceAmountKobo({ orderType, order }) {
  const renewal = Number(order.renewal_amount);
  const paid = Number(orderType === 'guest' ? order.total_amount : order.amount_paid);
  const delivery = Number(order.delivery_fee) || 0;
  const paidForService = paid > 0 ? paid - delivery : null;

  if (renewal > 0) {
    return Math.trunc(paidForService === null ? renewal : Math.min(renewal, paidForService));
  }
  return paidForService === null ? null : Math.trunc(paidForService);
}

/**
 * Resolve the agent cost (what Motoka pays the fulfilment agent) for every line
 * item on an order, preferring a cost set for the order's state over the default.
 *
 * Returns { totalKobo, costs, missing, lines, state, customerAmountKobo, profitKobo } where:
 *   totalKobo — sum of resolved costs, ready to put in agent_payouts.amount_kobo
 *   costs     — [{ service_type, service_key, cost_kobo, cost_source }]
 *   missing   — [{ service_type, service_key }] with no active cost row
 *   profitKobo — what Motoka keeps; null while the cost is incomplete
 *
 * `missing` is the whole reason this is a separate module rather than a inline
 * sum. A partially-priced order must not pay out a guess: the caller moves the
 * payout to manual_review and emails the operator. Paying 60% of an order and
 * quietly forgetting the rest is how reconciliation becomes impossible.
 */
export async function computeOrderCost({ orderType, order, state }) {
  const orderState = state !== undefined ? state : await resolveOrderState({ order });
  const customerAmountKobo = orderServiceAmountKobo({ orderType, order });
  const lines = orderLines({ orderType, order });
  if (lines.length === 0) {
    return { totalKobo: 0, costs: [], missing: [], lines: [], state: orderState, customerAmountKobo, profitKobo: null };
  }

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('agent_service_costs')
    .select('service_type, service_key, cost_kobo, state')
    .eq('active', true);

  if (error) {
    logError('[AgentCost] Failed to load cost table', { error: error.message });
    throw error;
  }

  const byKey = new Map(rows.map((r) => [`${r.service_type}:${r.service_key}:${r.state}`, r.cost_kobo]));

  const costs = [];
  const missing = [];
  for (const line of lines) {
    const key = `${line.service_type}:${line.service_key}`;
    const stateKey = `${key}:${orderState}`;
    const defaultKey = `${key}:${DEFAULT_COST_STATE}`;
    if (line.service_type === 'renewal_item' && FREE_RENEWAL_ITEMS.has(line.service_key)) {
      costs.push({ ...line, cost_kobo: 0, cost_source: 'free' });
    } else if (orderState && byKey.has(stateKey)) {
      costs.push({ ...line, cost_kobo: byKey.get(stateKey), cost_source: orderState });
    } else if (byKey.has(defaultKey)) {
      costs.push({ ...line, cost_kobo: byKey.get(defaultKey), cost_source: DEFAULT_COST_STATE });
    } else {
      missing.push({ service_type: line.service_type, service_key: line.service_key });
    }
  }

  const totalKobo = costs.reduce((sum, c) => sum + c.cost_kobo, 0);
  const profitKobo = missing.length === 0 && customerAmountKobo !== null ? customerAmountKobo - totalKobo : null;
  return { totalKobo, costs, missing, lines, state: orderState, customerAmountKobo, profitKobo };
}

/**
 * Normalise the two very different order shapes into one list of service lines.
 *
 * Regular orders (renewal_orders) carry a payment_purpose in metadata written by
 * buildPaymentMetadata, so a single order is EITHER a renewal (selected_items),
 * OR a plate (plate_type + sub_type), OR a licence (license_type + duration) —
 * never a mix. Guest orders (guest_renewal_orders) are renewals only.
 */
export function orderLines({ orderType, order }) {
  if (orderType === 'guest') {
    return guestLines(order);
  }
  return regularLines(order);
}

function regularLines(order) {
  const meta = order.metadata || {};
  const lines = [];

  // Plate number: one service line, keyed by plate type.
  if (meta.plate_type) {
    lines.push({ service_type: 'plate_number', service_key: meta.plate_type });
    return lines;
  }

  // Driver licence: one service line, keyed "license_type:duration".
  if (meta.license_type) {
    lines.push({
      service_type: 'driver_license',
      service_key: `${meta.license_type}:${meta.duration || 'unknown'}`,
    });
    return lines;
  }

  // Renewal: one line per selected item_key. The order's own column is the record:
  // payments write metadata.selected_items empty and keep the keys in the column.
  const items = [order.selected_items, meta.selected_items, meta.paymentScheduleId]
    .find((list) => Array.isArray(list) && list.length > 0) || [];
  for (const key of items) {
    if (typeof key === 'string' && key.trim()) {
      lines.push({ service_type: 'renewal_item', service_key: key.trim() });
    }
  }
  return lines;
}

function guestLines(order) {
  const items = Array.isArray(order.selected_items) ? order.selected_items : [];
  const lines = [];
  for (const key of items) {
    if (typeof key === 'string' && key.trim()) {
      lines.push({ service_type: 'renewal_item', service_key: key.trim() });
    }
  }
  return lines;
}

/**
 * Order lines for the admin payout ledger and for alert emails — a human label
 * per line so the operator can see what they are about to pay for.
 */
export async function describeOrderLines({ orderType, order }) {
  const { costs, missing } = await computeOrderCost({ orderType, order });
  const supabase = getSupabaseAdmin();

  const [renewalKeys, plateKeys, licenceKeys] = [
    uniq(costs.concat(missing).filter((l) => l.service_type === 'renewal_item').map((l) => l.service_key)),
    uniq(costs.concat(missing).filter((l) => l.service_type === 'plate_number').map((l) => l.service_key)),
    uniq(costs.concat(missing).filter((l) => l.service_type === 'driver_license').map((l) => l.service_key)),
  ];

  const [renewalNames, plateRows, licenceRows] = await Promise.all([
    renewalKeys.length
      ? supabase.from('renewal_items').select('item_key, name').in('item_key', renewalKeys)
      : Promise.resolve({ data: [] }),
    plateKeys.length
      ? supabase.from('plate_number_prices').select('plate_type, sub_type, price').in('plate_type', plateKeys)
      : Promise.resolve({ data: [] }),
    licenceKeys.length
      ? supabase.from('driver_license_prices').select('license_type, duration, price').in('duration', licenceKeys.map((k) => k.split(':')[1]))
      : Promise.resolve({ data: [] }),
  ]);

  const renewalName = new Map((renewalNames.data || []).map((r) => [r.item_key, r.name]));
  const lines = [];

  for (const c of costs.concat(missing)) {
    const resolved = costs.some((x) => x.service_type === c.service_type && x.service_key === c.service_key);
    if (c.service_type === 'renewal_item') {
      lines.push({ label: renewalName.get(c.service_key) || c.service_key, resolved });
    } else if (c.service_type === 'plate_number') {
      const row = (plateRows.data || []).find((p) => p.plate_type === c.service_key);
      lines.push({ label: `Plate — ${c.service_key}${row?.sub_type ? ` (${row.sub_type})` : ''}`, resolved });
    } else {
      const [lic, dur] = c.service_key.split(':');
      const row = (licenceRows.data || []).find((l) => l.license_type === lic && l.duration === dur);
      lines.push({ label: `Licence — ${lic} ${dur}${row ? '' : ''}`, resolved });
    }
  }
  return lines;
}

function uniq(arr) {
  return [...new Set(arr)];
}
