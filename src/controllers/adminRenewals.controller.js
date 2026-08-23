import { getSupabaseAdmin } from '../config/supabase.js';
import { buildExpiryStatus } from '../utils/expiryStatus.js';
import { parseMonthKey, bucketBounds, monthBounds } from '../utils/expiryMonth.js';
import { loadRenewalsSummary, sanitizeSearch } from '../services/renewalsSummary.service.js';
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
 * GET /admin/renewals/summary
 *
 * Counts only. Dashboard tiles hit this so they never pull the call list.
 * Prefers a single Postgres aggregate (RPC); falls back to index COUNTs.
 */
export const getRenewalsSummary = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const fresh = req.query.fresh === '1';
    const summary = await loadRenewalsSummary(supabaseAdmin, new Date(), { fresh });
    return response.success(res, {
      counts: summary.buckets,
      by_month: summary.by_month,
      expired_this_month: summary.expired_this_month,
      expired_total: summary.expired_total,
      expired_month: summary.expired_month,
      buckets: BUCKETS.map(({ key, label }) => ({ key, label, count: summary.buckets[key] || 0 })),
    }, 'Renewals summary retrieved');
  } catch (err) {
    logError('[Renewals] Summary failed', err);
    return response.error(res, 'Failed to load renewals summary');
  }
};

/**
 * GET /admin/renewals?bucket=&month=&search=&page=&limit=
 *
 * One page of cars in the requested window. Counts come from the summary
 * helper (aggregates), not from loading the table into Node.
 */
export const listRenewals = async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 25));
    const bucket = BUCKETS.some(b => b.key === req.query.bucket) ? req.query.bucket : 'expired';
    const month = bucket === 'expired' ? parseMonthKey(req.query.month) : null;
    const search = sanitizeSearch(req.query.search);

    const now = new Date();
    const fresh = req.query.fresh === '1';
    const summary = await loadRenewalsSummary(supabaseAdmin, now, { fresh });
    const todayIso = summary.today;

    let start = null;
    let end = null;
    if (month) {
      const bounds = monthBounds(month, todayIso);
      if (!bounds || bounds.start === bounds.end) {
        return response.success(res, {
          data: [],
          counts: summary.buckets,
          by_month: summary.by_month,
          month,
          buckets: BUCKETS.map(({ key, label }) => ({ key, label, count: summary.buckets[key] || 0 })),
          pagination: { total: 0, page, limit, total_pages: 1 },
        }, 'Renewals retrieved');
      }
      start = bounds.start;
      end = bounds.end;
    } else {
      const bounds = bucketBounds(bucket, todayIso);
      start = bounds?.start ?? null;
      end = bounds?.end ?? null;
    }

    let ownerIds = [];
    if (search) {
      const like = `"%${search}%"`;
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone_number.ilike.${like}`)
        .limit(50);
      ownerIds = (profiles || []).map(p => p.id).filter(Boolean);
    }

    const applyWindow = (query) => {
      let q = query.is('deleted_at', null).not('expiry_date', 'is', null);
      if (start) q = q.gte('expiry_date', start);
      if (end) q = q.lt('expiry_date', end);
      if (search) {
        const like = `"%${search}%"`;
        const parts = [
          `registration_no.ilike.${like}`,
          `plate_number.ilike.${like}`,
          `vehicle_make.ilike.${like}`,
        ];
        if (ownerIds.length) parts.push(`user_id.in.(${ownerIds.join(',')})`);
        q = q.or(parts.join(','));
      }
      return q;
    };

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const ascending = bucket !== 'expired';

    let pageQuery = applyWindow(
      supabaseAdmin
        .from('cars')
        .select('id, slug, registration_no, plate_number, vehicle_make, vehicle_model, vehicle_year, expiry_date, status, user_id', { count: 'exact' })
    )
      .order('expiry_date', { ascending })
      .range(from, to);

    const { data: cars, count, error } = await pageQuery;
    if (error) {
      logError('[Renewals] Failed to query cars', { error: error.message });
      return response.error(res, 'Failed to load renewals');
    }

    const pageCars = cars || [];
    const pageOwnerIds = [...new Set(pageCars.map(c => c.user_id).filter(Boolean))];
    const ownerMap = new Map();
    const openOrderByCar = new Map();
    const cancelledOrderByCar = new Map();
    const paidRenewalUsers = new Set();

    if (pageOwnerIds.length > 0 || pageCars.length > 0) {
      const carIds = pageCars.map(c => c.id);
      const [profilesRes, ordersRes, paymentsRes] = await Promise.all([
        pageOwnerIds.length
          ? supabaseAdmin.from('profiles').select('id, first_name, last_name, email, phone_number, user_id').in('id', pageOwnerIds)
          : Promise.resolve({ data: [] }),
        carIds.length
          ? supabaseAdmin
              .from('renewal_orders')
              .select('id, order_number, status, car_id, created_at')
              .in('car_id', carIds)
              .in('status', ['pending', 'processing', 'cancelled'])
          : Promise.resolve({ data: [] }),
        pageOwnerIds.length
          ? supabaseAdmin
              .from('payment_transactions')
              .select('user_id, payment_type')
              .eq('status', 'successful')
              .in('user_id', pageOwnerIds)
              .ilike('payment_type', '%renewal%')
              .limit(100)
          : Promise.resolve({ data: [] }),
      ]);

      (profilesRes.data || []).forEach(p => ownerMap.set(p.id, p));
      for (const order of ordersRes.data || []) {
        if (['pending', 'processing'].includes(order.status)) openOrderByCar.set(order.car_id, order);
        else if (order.status === 'cancelled') cancelledOrderByCar.set(order.car_id, order);
      }
      for (const p of paymentsRes.data || []) {
        if (String(p.payment_type || '').includes('renewal')) paidRenewalUsers.add(p.user_id);
      }
    }

    const renewalStateFor = (car) => {
      if (openOrderByCar.has(car.id)) return 'in_progress';
      if (cancelledOrderByCar.has(car.id) && paidRenewalUsers.has(car.user_id)) return 'needs_review';
      return 'chase';
    };

    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const rows = pageCars.map(car => {
      const owner = ownerMap.get(car.user_id) || {};
      const openOrder = openOrderByCar.get(car.id) || null;
      const expiry = buildExpiryStatus(car.expiry_date, now, openOrder);
      return {
        car_id: car.id,
        slug: car.slug,
        registration_no: car.registration_no || car.plate_number || null,
        vehicle: [car.vehicle_year, car.vehicle_make, car.vehicle_model].filter(Boolean).join(' ') || null,
        car_status: car.status,
        expiry_date: car.expiry_date,
        days_left: daysUntil(car.expiry_date, todayUtc),
        expiry_message: expiry.message,
        is_expired: expiry.is_expired,
        is_urgent: expiry.is_urgent,
        renewal_state: renewalStateFor(car),
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

    const total = count || 0;
    return response.success(res, {
      data: rows,
      counts: summary.buckets,
      by_month: summary.by_month,
      month,
      buckets: BUCKETS.map(({ key, label }) => ({ key, label, count: summary.buckets[key] || 0 })),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    }, 'Renewals retrieved');
  } catch (err) {
    logError('[Renewals] Unexpected error', err);
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
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
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
