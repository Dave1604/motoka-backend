/**
 * DETERMINISTIC DATE CALCULATIONS
 * 
 * All date calculations are done in UTC to ensure consistency
 * across different server timezones and daylight saving changes.
 * This ensures the system behaves the same regardless of where it runs.
 */

import { CONFIG } from './config.ts';
import { NotificationType } from './types.ts';

/**
 * Get today's date at midnight UTC (deterministic)
 * 
 * This ensures all calculations are based on UTC midnight,
 * regardless of the server's local timezone.
 */
export function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));
}

/**
 * Add days to a date (UTC-based)
 * 
 * @param date - Base date
 * @param days - Number of days to add (can be negative)
 * @returns New date with days added
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Calculate target expiry dates for today's notifications
 * 
 * Returns a map of notification types to their target expiry dates.
 * 
 * Example: If today is 2026-02-04
 * - reminder_30d: cars expiring on 2026-03-06 (30 days from now)
 * - reminder_7d: cars expiring on 2026-02-11 (7 days from now)
 * - expiry_day: cars expiring on 2026-02-04 (today)
 * - overdue_3d: cars that expired on 2026-02-01 (3 days ago)
 * 
 * @returns Map of notification type to target date
 */
export function calculateTargetDates(): Map<NotificationType, Date> {
  const today = getTodayUTC();
  const targetDates = new Map<NotificationType, Date>();

  for (const interval of CONFIG.NOTIFICATION_INTERVALS) {
    // For negative days (before expiry): add days to today
    // For positive days (after expiry): subtract days from today
    const targetDate = addDays(today, -interval.days);
    targetDates.set(interval.type, targetDate);
  }

  return targetDates;
}

/**
 * Format date to ISO string (YYYY-MM-DD)
 * 
 * Used for database queries and API responses.
 * 
 * @param date - Date to format
 * @returns ISO date string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate days between two dates (deterministic)
 * 
 * Uses UTC dates to ensure consistency.
 * Positive result means date2 is after date1.
 * 
 * @param date1 - First date
 * @param date2 - Second date
 * @returns Number of days between dates (positive or negative)
 */
export function daysBetween(date1: Date, date2: Date): number {
  const ms1 = Date.UTC(
    date1.getUTCFullYear(),
    date1.getUTCMonth(),
    date1.getUTCDate()
  );
  const ms2 = Date.UTC(
    date2.getUTCFullYear(),
    date2.getUTCMonth(),
    date2.getUTCDate()
  );
  return Math.round((ms2 - ms1) / (24 * 60 * 60 * 1000));
}

/**
 * Get human-readable time description
 * 
 * Used for logging and display.
 * 
 * @param days - Number of days
 * @returns Human-readable string
 */
export function formatDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day from now';
  if (days === -1) return '1 day ago';
  if (days > 0) return `${days} days from now`;
  return `${Math.abs(days)} days ago`;
}
