import { describe, it, expect } from '@jest/globals';
import { buildExpiryStatus } from '../utils/expiryStatus.js';

describe('buildExpiryStatus', () => {
  const fixedNow = new Date('2025-01-01T10:30:00Z'); // UTC-safe reference date

  it('should return no_reminder when expiry date is null/undefined', () => {
    expect(buildExpiryStatus(null, fixedNow)).toEqual({
      message: 'No reminder available',
      days_left: null,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    });

    expect(buildExpiryStatus(undefined, fixedNow)).toEqual({
      message: 'No reminder available',
      days_left: null,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    });
  });

  it('should return invalid status for non-parsable expiry date', () => {
    expect(buildExpiryStatus('not-a-date', fixedNow)).toEqual({
      message: 'Invalid expiry date',
      days_left: null,
      status: 'invalid',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    });
  });

  it('should return overdue with negative days when expiry is in the past', () => {
    const result = buildExpiryStatus('2024-12-20', fixedNow);

    expect(result.status).toBe('overdue');
    // 2024-12-20 to 2025-01-01 inclusive difference is -12 days at UTC midnight
    expect(result.days_left).toBeLessThan(0);
    expect(result.message).toBe('12 days overdue');
  });

  it('should return reminder with 0 days remaining when expiry is today', () => {
    const result = buildExpiryStatus('2025-01-01', fixedNow);

    expect(result).toEqual({
      message: 'Expires today',
      days_left: 0,
      status: 'reminder',
      is_urgent: true,
      is_expired: false,
      expires_today: true,
      has_pending_order: false,
      order_number: null
    });
  });

  it('should return reminder when expiry is within 30 days window', () => {
    const result = buildExpiryStatus('2025-01-15', fixedNow);

    expect(result.status).toBe('reminder');
    expect(result.days_left).toBe(14);
    expect(result.message).toBe('14 days to expire');
  });

  it('should correctly pluralize day label for single day remaining', () => {
    const result = buildExpiryStatus('2025-01-02', fixedNow);

    expect(result).toEqual({
      message: '1 day to expire',
      days_left: 1,
      status: 'reminder',
      is_urgent: true,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    });
  });

  it('should return no_reminder when expiry is more than 30 days away', () => {
    const result = buildExpiryStatus('2025-02-15', fixedNow);

    expect(result).toEqual({
      message: 'No reminder available',
      days_left: 45,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    });
  });
});

