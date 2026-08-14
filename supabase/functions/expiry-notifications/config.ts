/**
 * PRODUCTION CONFIGURATION
 * All constants for the expiry notification system
 */

import { NotificationInterval } from './types.ts';

export const CONFIG = {
  // Notification intervals (days from expiry)
  NOTIFICATION_INTERVALS: [
    { days: -30, type: 'reminder_30d', name: '1 Month Before' },
    { days: -14, type: 'reminder_14d', name: '2 Weeks Before' },
    { days: -7, type: 'reminder_7d', name: '1 Week Before' },
    { days: -3, type: 'reminder_3d', name: '3 Days Before' },
    { days: -2, type: 'reminder_2d', name: '2 Days Before' },
    { days: -1, type: 'reminder_1d', name: '1 Day Before' },
    { days: 0, type: 'expiry_day', name: 'Expiry Day' },
    { days: 3, type: 'overdue_3d', name: '3 Days Overdue' },
    { days: 7, type: 'overdue_7d', name: '1 Week Overdue' },
  ] as NotificationInterval[],

  // Rate limiting (Resend API limits)
  RATE_LIMIT: {
    BATCH_SIZE: 50,              // Process 50 emails per batch
    BATCH_DELAY_MS: 1000,        // Wait 1s between batches
    MAX_CONCURRENT: 10,          // Max 10 concurrent email sends
    RESEND_RATE_LIMIT: 100,      // Resend allows ~100 emails/second
  },

  // Retry logic (exponential backoff)
  RETRY: {
    MAX_ATTEMPTS: 3,
    INITIAL_DELAY_MS: 1000,      // 1 second
    MULTIPLIER: 2,               // 1s, 2s, 4s
    MAX_DELAY_MS: 10000,         // Cap at 10 seconds
  },

  // Timeouts (milliseconds)
  TIMEOUT: {
    EDGE_FUNCTION_MS: 540000,    // 9 minutes (Supabase limit: 10min)
    DATABASE_QUERY_MS: 30000,    // 30 seconds per query
    EMAIL_SEND_MS: 10000,        // 10 seconds per email
  },

  // Logging
  LOG_LEVEL: 'info' as const,    // 'debug' | 'info' | 'warn' | 'error'

  // Timezone
  TIMEZONE: 'UTC',               // All calculations in UTC

  // Public app URL used for renewal links in emails
  APP_URL: Deno.env.get('FRONTEND_URL') || 'https://app.motoka.ng',
};

// Type-safe access to config
export type CONFIG_TYPE = typeof CONFIG;
