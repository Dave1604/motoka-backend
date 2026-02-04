import { describe, it, expect } from '@jest/globals';
import { buildExpiryStatus } from '../utils/expiryStatus.js';

describe('buildExpiryStatus', () => {
  const fixedNow = new Date('2025-01-01T10:30:00Z'); // UTC-safe reference date

  it('should return no_reminder when expiry date is null/undefined', () => {
    expect(buildExpiryStatus(null, fixedNow)).toEqual({
      status: 'no_reminder',
      days_remaining: null,
      label: 'No reminder available',
    });

    expect(buildExpiryStatus(undefined, fixedNow)).toEqual({
      status: 'no_reminder',
      days_remaining: null,
      label: 'No reminder available',
    });
  });

  it('should return invalid status for non-parsable expiry date', () => {
    expect(buildExpiryStatus('not-a-date', fixedNow)).toEqual({
      status: 'invalid',
      days_remaining: null,
      label: 'Invalid expiry date',
    });
  });

  it('should return overdue with negative days when expiry is in the past', () => {
    const result = buildExpiryStatus('2024-12-20', fixedNow);

    expect(result.status).toBe('overdue');
    // 2024-12-20 to 2025-01-01 inclusive difference is -12 days at UTC midnight
    expect(result.days_remaining).toBeLessThan(0);
    expect(result.label).toBe('Overdue');
  });

  it('should return reminder with 0 days remaining when expiry is today', () => {
    const result = buildExpiryStatus('2025-01-01', fixedNow);

    expect(result).toEqual({
      status: 'reminder',
      days_remaining: 0,
      label: '0 days remaining',
    });
  });

  it('should return reminder when expiry is within 30 days window', () => {
    const result = buildExpiryStatus('2025-01-15', fixedNow);

    expect(result.status).toBe('reminder');
    expect(result.days_remaining).toBe(14);
    expect(result.label).toBe('14 days remaining');
  });

  it('should correctly pluralize day label for single day remaining', () => {
    const result = buildExpiryStatus('2025-01-02', fixedNow);

    expect(result).toEqual({
      status: 'reminder',
      days_remaining: 1,
      label: '1 day remaining',
    });
  });

  it('should return no_reminder when expiry is more than 30 days away', () => {
    const result = buildExpiryStatus('2025-02-15', fixedNow);

    expect(result).toEqual({
      status: 'no_reminder',
      days_remaining: 45,
      label: 'No reminder available',
    });
  });
});

