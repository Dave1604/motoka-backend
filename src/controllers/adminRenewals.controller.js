import { getSupabaseAdmin } from '../config/supabase.js';
import { buildExpiryStatus } from '../utils/expiryStatus.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';

/**
 * ADMIN RENEWALS
 *
 * A read-only call list of vehicles whose licence has expired or is about to.
 * Nothing here sends anything — the daily `expiry-notifications` edge function
 * owns outbound messaging. This exists so the team can see and work the book by
 * hand, which matters because outbound has not been reliable.
 *
 * Grouped by urgency rather than paged through a flat list, because the
 * question being asked is always "who do we call today".
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Ordered most-urgent-first; `expired` is deliberately first — it is the
// largest cohort and the one no automated reminder looks back at.
const BUCKETS = [
  { key: 'expired',  label: 'Expired',        min: -Infinity, max: -1 },
  { key: 'today',    label: 'Expires today',  min: 0,         max: 0 },
  { key: 'week',     label: 'Next 7 days',    min: 1,         max: 7 },
  { key: 'month',    label: '8–30 days',      min: 8,         max: 30 },
  { key: 'quarter',  label: '31–90 days',     min: 31,        max: 90 },
];

const bucketFor = (daysLeft) =>
  BUCKETS.find(b => daysLeft >= b.min && daysLeft <= b.max)?.key ?? null;

const daysUntil = (expiryDate, today) => {
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.round((expiryUtc - today) / MS_PER_DAY);
};

/**
 * GET /admin/renewals?bucket=&search=&page=&limit=
 *
 * Returns one page of the requested bucket plus counts for every bucket, so the
 * tab badges stay accurate regardless of which tab is open.
 */
export const listRenewals = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));
    const bucket = BUCKETS.some(b => b.key === req.query.bucket) ? req.query.bucket : 'expired';
    const search = req.query.search?.trim().toLowerCase() || null;

    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // The whole book is a few hundred rows and every bucket count is needed on
    // every render, so it is cheaper to pull the expiry columns once than to run
    // six windowed count queries per request.
    const { data: cars, error } = await supabaseAdmin
      .from('cars')
      .select('id, slug, registration_no, plate_number, vehicle_make, vehicle_model, vehicle_year, expiry_date, status, user_id')
      .is('deleted_at', null)
      .not('expiry_date', 'is', null);

    if (error) {
      logError('[Renewals] Failed to query cars', { error: error.message });
      return response.error(res, 'Failed to load renewals');
    }

    const counts = Object.fromEntries(BUCKETS.map(b => [b.key, 0]));
    const inBucket = [];

    for (const car of cars || []) {
      const daysLeft = daysUntil(car.expiry_date, today);
      if (daysLeft === null) continue;

      const key = bucketFor(daysLeft);
      if (!key) continue; // beyond 90 days — not a call target

      counts[key] += 1;
      if (key === bucket) inBucket.push({ ...car, daysLeft });
    }

    // Most urgent first: for expired that means longest-overdue first.
    inBucket.sort((a, b) => a.daysLeft - b.daysLeft);

    // Owner details for the rows we are about to return, not the whole book.
    const ownerIds = [...new Set(inBucket.map(c => c.user_id).filter(Boolean))];
    const ownerMap = new Map();

    if (ownerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, email, phone_number, user_id')
        .in('id', ownerIds);
      (profiles || []).forEach(p => ownerMap.set(p.id, p));
    }

    // A past expiry date on its own does not mean the customer owes anything —
    // they may have already paid. Chasing someone who has paid is worse than not
    // calling at all, so pull their renewal orders and payments too.
    const carIds = inBucket.map(c => c.id);
    const openOrderByCar = new Map();     // renewal underway → do not chase
    const cancelledOrderByCar = new Map();
    const paidRenewalUsers = new Set();

    if (carIds.length > 0) {
      const [{ data: orders }, { data: payments }] = await Promise.all([
        supabaseAdmin
          .from('renewal_orders')
          .select('id, order_number, status, car_id, created_at')
          .in('car_id', carIds),
        supabaseAdmin
          .from('payment_transactions')
          .select('user_id, payment_type')
          .eq('status', 'successful')
          .in('user_id', ownerIds.length ? ownerIds : ['00000000-0000-0000-0000-000000000000']),
      ]);

      for (const order of orders || []) {
        if (['pending', 'processing'].includes(order.status)) {
          openOrderByCar.set(order.car_id, order);
        } else if (order.status === 'cancelled') {
          cancelledOrderByCar.set(order.car_id, order);
        }
      }

      for (const p of payments || []) {
        if (String(p.payment_type || '').includes('renewal')) paidRenewalUsers.add(p.user_id);
      }
    }

    /**
     * chase        — genuinely owes a renewal, safe to contact
     * in_progress  — an order is already open; contacting them just causes confusion
     * needs_review — money took, order cancelled, vehicle never renewed. This is a
     *                billing problem to resolve, NOT a sales call.
     */
    const renewalStateFor = (car) => {
      if (openOrderByCar.has(car.id)) return 'in_progress';
      if (cancelledOrderByCar.has(car.id) && paidRenewalUsers.has(car.user_id)) return 'needs_review';
      return 'chase';
    };

    // Search runs after the owner join so it can match on owner name/email/phone
    // as well as the vehicle — admins search by whatever they have to hand.
    const matched = search
      ? inBucket.filter(car => {
          const o = ownerMap.get(car.user_id) || {};
          const haystack = [
            car.registration_no, car.plate_number, car.vehicle_make, car.vehicle_model,
            o.first_name, o.last_name, o.email, o.phone_number,
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(search);
        })
      : inBucket;

    const total = matched.length;
    const start = (page - 1) * limit;
    const rows = matched.slice(start, start + limit).map(car => {
      const owner = ownerMap.get(car.user_id) || {};
      const openOrder = openOrderByCar.get(car.id) || null;
      const renewalState = renewalStateFor(car);
      // Passing the open order flips the status to "Renewal in progress" rather
      // than "N days overdue" — the util has always supported this.
      const expiry = buildExpiryStatus(car.expiry_date, now, openOrder);
      return {
        car_id: car.id,
        slug: car.slug,
        registration_no: car.registration_no || car.plate_number || null,
        vehicle: [car.vehicle_year, car.vehicle_make, car.vehicle_model].filter(Boolean).join(' ') || null,
        car_status: car.status,
        expiry_date: car.expiry_date,
        days_left: car.daysLeft,
        expiry_message: expiry.message,
        is_expired: expiry.is_expired,
        is_urgent: expiry.is_urgent,
        renewal_state: renewalState,
        open_order_number: openOrder?.order_number || null,
        cancelled_order_number: cancelledOrderByCar.get(car.id)?.order_number || null,
        owner: {
          id: car.user_id,
          user_id: owner.user_id || null,
          name: `${owner.first_name || ''} ${owner.last_name || ''}`.trim() || null,
          email: owner.email || null,
          phone: owner.phone_number || null,
        },
      };
    });

    // State split across the WHOLE bucket, not just this page — the dashboard uses
    // it to show how many of the expired are actually callable.
    const states = { chase: 0, in_progress: 0, needs_review: 0 };
    for (const car of inBucket) states[renewalStateFor(car)] += 1;

    return response.success(res, {
      data: rows,
      counts,
      states,
      buckets: BUCKETS.map(({ key, label }) => ({ key, label, count: counts[key] })),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    }, 'Renewals retrieved');
  } catch (err) {
    logError('[Renewals] Unexpected error', { error: err.message });
    return response.error(res, 'Failed to load renewals');
  }
};

/**
 * GET /admin/renewals/deferred?page=&limit=
 *
 * Customers who hit "remind me later" on a specific document at checkout.
 * They asked to be contacted, so they are the warmest list in the product —
 * and until now nothing has ever read this table.
 */
export const listDeferredRenewals = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const { data: reminders, count, error } = await supabaseAdmin
      .from('deferred_document_reminders')
      .select('id, user_id, guest_email, car_id, plate_number, document_name, reason, custom_reason, expiry_date, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logError('[Renewals] Failed to query deferred reminders', { error: error.message });
      return response.error(res, 'Failed to load deferred reminders');
    }

    const userIds = [...new Set((reminders || []).map(r => r.user_id).filter(Boolean))];
    const ownerMap = new Map();

    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, email, phone_number')
        .in('id', userIds);
      (profiles || []).forEach(p => ownerMap.set(p.id, p));
    }

    const rows = (reminders || []).map(r => {
      const owner = ownerMap.get(r.user_id) || {};
      return {
        id: r.id,
        document_name: r.document_name,
        reason: r.reason,
        custom_reason: r.custom_reason,
        expiry_date: r.expiry_date,
        plate_number: r.plate_number,
        requested_at: r.created_at,
        owner: {
          id: r.user_id,
          name: `${owner.first_name || ''} ${owner.last_name || ''}`.trim() || null,
          // Guests have no profile — fall back to the email they checked out with
          email: owner.email || r.guest_email || null,
          phone: owner.phone_number || null,
          is_guest: !r.user_id,
        },
      };
    });

    return response.success(res, {
      data: rows,
      pagination: {
        total: count || 0,
        page,
        limit,
        total_pages: Math.max(1, Math.ceil((count || 0) / limit)),
      },
    }, 'Deferred reminders retrieved');
  } catch (err) {
    logError('[Renewals] Unexpected error in deferred', { error: err.message });
    return response.error(res, 'Failed to load deferred reminders');
  }
};
