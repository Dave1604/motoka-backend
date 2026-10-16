import { ORDER_STATUS, ORDER_TYPE } from '../../constants/payment.constants.js';

// Days before expiry from which a paid renewal becomes actionable.
// Early payments are held as 'scheduled' so ops never sleeps on them.
export const RENEWAL_WINDOW_DAYS =
  parseInt(process.env.RENEWAL_WINDOW_DAYS || '30', 10) || 30;

// Fresh duplicate payments chain silently only when the covering order is
// old enough that this cannot be a double-click. Anything sooner needs an
// explicit confirm_duplicate from the client.
export const CHAIN_SILENT_AFTER_MINUTES =
  parseInt(process.env.CHAIN_SILENT_AFTER_MINUTES || '15', 10) || 15;

export const IN_FLIGHT_ORDER_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
  'scheduled',
];

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const addMonths = (d, m) => {
  const c = new Date(d);
  c.setMonth(c.getMonth() + m);
  return c;
};

export const daysUntil = (date, from = new Date()) => {
  const d = toDate(date);
  if (!d) return null;
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(d);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
};

// Order types that renew on a yearly cycle (expiry-anchored). One-shot
// fulfilments (plate, driver licence) are always actionable immediately.
export const isCyclicalOrderType = (orderType) =>
  orderType === ORDER_TYPE.RENEWAL_MANUAL || orderType === ORDER_TYPE.RENEWAL_AUTO;

/**
 * Decide hold vs actionable for a paid renewal.
 * @returns { previousExpiry: 'YYYY-MM-DD'|null, scheduledFor: 'YYYY-MM-DD'|null }
 * scheduledFor null = process now.
 */
export function computeSchedule({ expiryDate, renewalMonths = 12, today = new Date() } = {}) {
  const expiry = toDate(expiryDate);
  if (!expiry) return { previousExpiry: null, scheduledFor: null };
  const previousExpiry = isoDay(expiry);
  if (daysUntil(expiry, today) <= RENEWAL_WINDOW_DAYS) {
    return { previousExpiry, scheduledFor: null };
  }
  return { previousExpiry, scheduledFor: isoDay(addDays(expiry, -RENEWAL_WINDOW_DAYS)) };
}

/**
 * Anchor a chained next-cycle payment after the latest in-flight order.
 * @param inFlightOrders rows with { previous_expiry_date, renewal_months, created_at }
 * @returns 'YYYY-MM-DD' cycle start, or null when there is nothing to chain after.
 */
export function chainAnchor(inFlightOrders = [], renewalMonths = 12) {
  let end = null;
  for (const o of inFlightOrders || []) {
    const start = toDate(o.previous_expiry_date);
    if (!start) continue;
    const targetEnd = addMonths(start, Number(o.renewal_months) || renewalMonths || 12);
    if (!end || targetEnd > end) end = targetEnd;
  }
  return end ? isoDay(end) : null;
}

/**
 * Item overlap between a new payment selection and an in-flight order.
 */
export function itemsOverlap(requestedItems = [], orderItems = []) {
  const req = new Set((requestedItems || []).map(String));
  if (req.size === 0) return false;
  return (orderItems || []).some((i) => req.has(String(i)));
}

/**
 * Resolve hold-vs-actionable for a paid renewal, including next-cycle
 * chaining when an in-flight order already covers the same items.
 *
 * @returns { scheduledFor, previousExpiryOverride, chainedAfterOrderNumber }
 * scheduledFor null = process now. All dates 'YYYY-MM-DD' or null.
 */
export async function resolveOrderSchedule(supabaseAdmin, {
  carId,
  orderType,
  renewalMonths = 12,
  requestedItems = [],
  today = new Date(),
} = {}) {
  const empty = { scheduledFor: null, previousExpiryOverride: null, chainedAfterOrderNumber: null };
  if (!carId || !isCyclicalOrderType(orderType)) return empty;

  const { data: car } = await supabaseAdmin
    .from('cars')
    .select('id, expiry_date')
    .eq('id', carId)
    .maybeSingle();
  if (!car?.expiry_date) return empty;

  const { data: inFlight } = await supabaseAdmin
    .from('renewal_orders')
    .select('order_number, status, previous_expiry_date, renewal_months, selected_items, created_at')
    .eq('car_id', carId)
    .in('status', IN_FLIGHT_ORDER_STATUSES);

  const covering = (inFlight || []).filter((o) => itemsOverlap(requestedItems, o.selected_items));
  if (covering.length > 0) {
    const anchor = chainAnchor(covering, renewalMonths);
    if (anchor) {
      const latest = covering.reduce((a, b) =>
        new Date(b.created_at) > new Date(a.created_at) ? b : a
      );
      // A chained cycle always starts ~a year out, so its window is in the
      // future by construction — always held, never actionable now.
      return {
        scheduledFor: isoDay(addDays(new Date(anchor), -RENEWAL_WINDOW_DAYS)),
        previousExpiryOverride: anchor,
        chainedAfterOrderNumber: latest.order_number,
      };
    }
  }

  const { previousExpiry, scheduledFor } = computeSchedule({
    expiryDate: car.expiry_date,
    renewalMonths,
    today,
  });
  return { scheduledFor, previousExpiryOverride: previousExpiry, chainedAfterOrderNumber: null };
}
