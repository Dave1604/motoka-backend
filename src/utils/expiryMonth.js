/**
 * Calendar-month grouping for expired vehicle licences.
 *
 * Dates are DATE columns (no timezone). Parse and bucket in UTC so a licence
 * that expired on 2026-08-15 is always "August 2026", regardless of the
 * server's local offset.
 */

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const parseMonthKey = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return MONTH_KEY.test(trimmed) ? trimmed : null;
};

export const expiryMonthKey = (expiryDate) => {
  if (!expiryDate) return null;
  const d = new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return null;
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${month}`;
};

export const currentMonthKey = (now = new Date()) => expiryMonthKey(now);

/** YYYY-MM-DD in UTC. DATE columns compare cleanly against this. */
export const utcDateIso = (now = new Date()) => {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const addUtcDaysIso = (iso, days) => {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return null;
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return utcDateIso(next);
};

/**
 * Half-open [start, end) bounds for a calendar month.
 * Intersect with `before` (typically today) so future days in the current
 * month are not counted as expired.
 */
export const monthBounds = (key, beforeIso = null) => {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  const [year, month] = parsed.split('-').map(Number);
  const start = `${parsed}-01`;
  const end = utcDateIso(new Date(Date.UTC(year, month, 1)));
  if (!beforeIso) return { start, end };
  if (start >= beforeIso) return { start, end: start };
  return { start, end: beforeIso < end ? beforeIso : end };
};

/**
 * Half-open [start, end) window for an urgency bucket.
 * `start: null` means unbounded past (expired).
 */
export const bucketBounds = (bucket, todayIso) => {
  switch (bucket) {
    case 'expired': return { start: null, end: todayIso };
    case 'today':   return { start: todayIso, end: addUtcDaysIso(todayIso, 1) };
    case 'week':    return { start: addUtcDaysIso(todayIso, 1), end: addUtcDaysIso(todayIso, 8) };
    case 'month':   return { start: addUtcDaysIso(todayIso, 8), end: addUtcDaysIso(todayIso, 31) };
    case 'quarter': return { start: addUtcDaysIso(todayIso, 31), end: addUtcDaysIso(todayIso, 91) };
    default:        return null;
  }
};

export const monthLabel = (key, { long = false } = {}) => {
  const parsed = parseMonthKey(key);
  if (!parsed) return key || '';
  const [year, month] = parsed.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: long ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * Count currently-expired cars by the calendar month their licence lapsed.
 *
 * @param {Array<{ expiry_date: string }>} cars
 * @param {number} todayUtc - UTC midnight of "today", same basis as daysUntil
 * @param {(expiryDate: string, todayUtc: number) => number|null} daysUntil
 * @returns {Array<{ month: string, label: string, count: number }>} newest first
 */
export const groupExpiredByMonth = (cars, todayUtc, daysUntil) => {
  const counts = new Map();

  for (const car of cars || []) {
    const daysLeft = daysUntil(car.expiry_date, todayUtc);
    if (daysLeft === null || daysLeft >= 0) continue;

    const key = expiryMonthKey(car.expiry_date);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, count]) => ({
      month,
      label: monthLabel(month),
      count,
    }));
};
