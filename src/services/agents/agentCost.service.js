import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';

/**
 * Resolve the agent cost (what Motoka pays the fulfilment agent) for every line
 * item on an order.
 *
 * Returns { totalKobo, costs, missing } where:
 *   totalKobo — sum of resolved costs, ready to put in agent_payouts.amount_kobo
 *   costs     — [{ service_type, service_key, cost_kobo }]
 *   missing   — [{ service_type, service_key }] with no active cost row
 *
 * `missing` is the whole reason this is a separate module rather than a inline
 * sum. A partially-priced order must not pay out a guess: the caller moves the
 * payout to manual_review and emails the operator. Paying 60% of an order and
 * quietly forgetting the rest is how reconciliation becomes impossible.
 */
export async function computeOrderCost({ orderType, order }) {
  const lines = orderLines({ orderType, order });
  if (lines.length === 0) {
    return { totalKobo: 0, costs: [], missing: [], lines: [] };
  }

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('agent_service_costs')
    .select('service_type, service_key, cost_kobo')
    .eq('active', true);

  if (error) {
    logError('[AgentCost] Failed to load cost table', { error: error.message });
    throw error;
  }

  const byKey = new Map(rows.map((r) => [`${r.service_type}:${r.service_key}`, r.cost_kobo]));

  const costs = [];
  const missing = [];
  for (const line of lines) {
    const key = `${line.service_type}:${line.service_key}`;
    if (byKey.has(key)) {
      costs.push({ ...line, cost_kobo: byKey.get(key) });
    } else {
      missing.push({ service_type: line.service_type, service_key: line.service_key });
    }
  }

  const totalKobo = costs.reduce((sum, c) => sum + c.cost_kobo, 0);
  return { totalKobo, costs, missing, lines };
}

/**
 * Normalise the two very different order shapes into one list of service lines.
 *
 * Regular orders (renewal_orders) carry a payment_purpose in metadata written by
 * buildPaymentMetadata, so a single order is EITHER a renewal (selected_items),
 * OR a plate (plate_type + sub_type), OR a licence (license_type + duration) —
 * never a mix. Guest orders (guest_renewal_orders) are renewals only.
 */
function orderLines({ orderType, order }) {
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

  // Renewal: one line per selected item_key.
  const items = Array.isArray(meta.selected_items) ? meta.selected_items : [];
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
