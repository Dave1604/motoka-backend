import { logError, logWarn } from '../utils/logger.js';
import {
  utcDateIso,
  monthBounds,
  monthLabel,
  currentMonthKey,
  groupExpiredByMonth,
} from '../utils/expiryMonth.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_FETCH_CAP = 20000;
const MONTH_WINDOW = 12;
const SUMMARY_TTL_MS = 45 * 1000;

let summaryCache = { value: null, expiresAt: 0 };

const daysUntil = (expiryDate, todayUtc) => {
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.round((expiryUtc - todayUtc) / MS_PER_DAY);
};

const emptySummary = (todayIso) => ({
  buckets: { expired: 0, today: 0, week: 0, month: 0, quarter: 0 },
  expired_this_month: 0,
  expired_total: 0,
  expired_month: currentMonthKey(),
  by_month: [],
  today: todayIso,
});

const activeCars = (supabase) =>
  supabase
    .from('cars')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .not('expiry_date', 'is', null);

const countRange = async (supabase, start, end) => {
  let query = activeCars(supabase);
  if (start) query = query.gte('expiry_date', start);
  if (end) query = query.lt('expiry_date', end);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
};

const withLabels = (rows) =>
  (rows || [])
    .filter(r => r && r.month && r.count > 0)
    .map(r => ({
      month: r.month,
      label: r.label || monthLabel(r.month),
      count: Number(r.count) || 0,
    }));

/**
 * One round-trip when the RPC exists; otherwise five index COUNTs plus a
 * bounded date fetch. Never loads full car rows onto the Node heap.
 *
 * Cached briefly so the dashboard tile, summary endpoint, and call-list
 * page do not each hit Postgres on every click.
 */
export const loadRenewalsSummary = async (supabase, now = new Date(), { fresh = false } = {}) => {
  if (!fresh && summaryCache.value && Date.now() < summaryCache.expiresAt) {
    return summaryCache.value;
  }

  const value = await computeRenewalsSummary(supabase, now);
  summaryCache = { value, expiresAt: Date.now() + SUMMARY_TTL_MS };
  return value;
};

const computeRenewalsSummary = async (supabase, now) => {
  const todayIso = utcDateIso(now);
  const thisMonth = currentMonthKey(now);

  const { data: rpcData, error: rpcError } = await supabase.rpc('admin_renewals_summary');
  if (!rpcError && rpcData) {
    const buckets = rpcData.buckets || {};
    return {
      buckets: {
        expired: Number(buckets.expired) || 0,
        today: Number(buckets.today) || 0,
        week: Number(buckets.week) || 0,
        month: Number(buckets.month) || 0,
        quarter: Number(buckets.quarter) || 0,
      },
      expired_this_month: Number(rpcData.expired_this_month) || 0,
      expired_total: Number(rpcData.expired_total) || Number(buckets.expired) || 0,
      expired_month: thisMonth,
      by_month: withLabels(rpcData.by_month),
      today: todayIso,
    };
  }

  if (rpcError) {
    logWarn('[Renewals] admin_renewals_summary RPC unavailable, using index counts', {
      error: rpcError.message,
    });
  }

  try {
    const monthWindow = monthBounds(thisMonth, todayIso);
    const [
      expired,
      dueToday,
      week,
      month,
      quarter,
      expiredThisMonth,
    ] = await Promise.all([
      countRange(supabase, null, todayIso),
      countRange(supabase, todayIso, addDays(todayIso, 1)),
      countRange(supabase, addDays(todayIso, 1), addDays(todayIso, 8)),
      countRange(supabase, addDays(todayIso, 8), addDays(todayIso, 31)),
      countRange(supabase, addDays(todayIso, 31), addDays(todayIso, 91)),
      monthWindow ? countRange(supabase, monthWindow.start, monthWindow.end) : Promise.resolve(0),
    ]);

    const windowStart = shiftMonth(thisMonth, -(MONTH_WINDOW - 1));
    const { data: dates, error: datesError } = await supabase
      .from('cars')
      .select('expiry_date')
      .is('deleted_at', null)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', `${windowStart}-01`)
      .lt('expiry_date', todayIso)
      .limit(DATE_FETCH_CAP);

    if (datesError) throw datesError;
    if ((dates || []).length === DATE_FETCH_CAP) {
      logWarn('[Renewals] Monthly histogram hit fetch cap; install admin_renewals_summary RPC', {
        cap: DATE_FETCH_CAP,
      });
    }

    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const byMonth = groupExpiredByMonth(dates || [], todayUtc, daysUntil);

    return {
      buckets: { expired, today: dueToday, week, month, quarter },
      expired_this_month: expiredThisMonth,
      expired_total: expired,
      expired_month: thisMonth,
      by_month: byMonth,
      today: todayIso,
    };
  } catch (err) {
    logError('[Renewals] Summary fallback failed', err);
    return emptySummary(todayIso);
  }
};

const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return utcDateIso(new Date(Date.UTC(y, m - 1, d + days)));
};

const shiftMonth = (key, delta) => {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Safe fragment for PostgREST `.or()` filters. Strips operators and quotes
 * so a search cannot break out of `column.ilike."%…%"`.
 */
export const sanitizeSearch = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/["'\\,()%*_]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 64);
  return cleaned.length >= 2 ? cleaned.toLowerCase() : null;
};
