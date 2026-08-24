import { describe, it, expect } from '@jest/globals';
import {
  parseMonthKey,
  expiryMonthKey,
  currentMonthKey,
  monthLabel,
  groupExpiredByMonth,
  monthBounds,
  bucketBounds,
} from '../utils/expiryMonth.js';
import { sanitizeSearch } from '../services/renewalsSummary.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const daysUntil = (expiryDate, todayUtc) => {
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.round((expiryUtc - todayUtc) / MS_PER_DAY);
};

describe('expiryMonth helpers', () => {
  it('accepts YYYY-MM and rejects anything else', () => {
    expect(parseMonthKey('2026-08')).toBe('2026-08');
    expect(parseMonthKey(' 2026-08 ')).toBe('2026-08');
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-8')).toBeNull();
    expect(parseMonthKey('August 2026')).toBeNull();
    expect(parseMonthKey(null)).toBeNull();
  });

  it('buckets a DATE string into UTC year-month', () => {
    expect(expiryMonthKey('2026-08-01')).toBe('2026-08');
    expect(expiryMonthKey('2026-08-23')).toBe('2026-08');
    expect(expiryMonthKey('2025-12-31')).toBe('2025-12');
    expect(expiryMonthKey('not-a-date')).toBeNull();
    expect(expiryMonthKey(null)).toBeNull();
  });

  it('labels months in en-GB without depending on server timezone', () => {
    expect(monthLabel('2026-08')).toBe('Aug 2026');
    expect(monthLabel('2026-08', { long: true })).toBe('August 2026');
    expect(monthLabel('bad')).toBe('bad');
  });

  it('currentMonthKey matches the UTC month of now', () => {
    expect(currentMonthKey(new Date('2026-08-23T20:00:00Z'))).toBe('2026-08');
  });

  it('monthBounds is half-open and clips the current month at today', () => {
    expect(monthBounds('2026-07')).toEqual({ start: '2026-07-01', end: '2026-08-01' });
    expect(monthBounds('2026-08', '2026-08-23')).toEqual({ start: '2026-08-01', end: '2026-08-23' });
    expect(monthBounds('2026-09', '2026-08-23')).toEqual({ start: '2026-09-01', end: '2026-09-01' });
  });

  it('bucketBounds uses index-friendly date ranges, not in-memory day math', () => {
    expect(bucketBounds('expired', '2026-08-23')).toEqual({ start: null, end: '2026-08-23' });
    expect(bucketBounds('today', '2026-08-23')).toEqual({ start: '2026-08-23', end: '2026-08-24' });
    expect(bucketBounds('week', '2026-08-23')).toEqual({ start: '2026-08-24', end: '2026-08-31' });
  });

  it('groups only currently-expired cars, newest month first', () => {
    const today = Date.UTC(2026, 7, 23); // 23 Aug 2026
    const cars = [
      { expiry_date: '2026-08-10' },
      { expiry_date: '2026-08-01' },
      { expiry_date: '2026-08-30' }, // not yet expired
      { expiry_date: '2026-07-15' },
      { expiry_date: '2026-07-02' },
      { expiry_date: '2025-12-01' },
      { expiry_date: null },
      { expiry_date: 'nope' },
    ];

    expect(groupExpiredByMonth(cars, today, daysUntil)).toEqual([
      { month: '2026-08', label: 'Aug 2026', count: 2 },
      { month: '2026-07', label: 'Jul 2026', count: 2 },
      { month: '2025-12', label: 'Dec 2025', count: 1 },
    ]);
  });
});

describe('sanitizeSearch', () => {
  it('rejects short or empty input', () => {
    expect(sanitizeSearch('')).toBeNull();
    expect(sanitizeSearch('a')).toBeNull();
    expect(sanitizeSearch(null)).toBeNull();
  });

  it('strips PostgREST filter metacharacters', () => {
    expect(sanitizeSearch('id.eq.1,status.eq.x')).toBe('id.eq.1status.eq.x');
    expect(sanitizeSearch('foo%bar_baz')).toBe('foobarbaz');
    expect(sanitizeSearch('say "hi"')).toBe('say hi');
  });

  it('keeps email and phone-safe characters', () => {
    expect(sanitizeSearch('Jane Doe')).toBe('jane doe');
    expect(sanitizeSearch('ada@motoka.ng')).toBe('ada@motoka.ng');
    expect(sanitizeSearch('0803-123-4567')).toBe('0803-123-4567');
  });
});
