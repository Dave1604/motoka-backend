/**
 * Vehicle Expiry Notifications Edge Function
 * 
 * Sends automated email reminders for expiring vehicle documents
 * Called daily by cron job or Supabase scheduler
 * 
 * Features: Idempotent, retry logic, rate limiting, comprehensive logging
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { CONFIG } from './config.ts';
import {
  calculateTargetDates,
  formatDateISO,
  getTodayUTC,
  daysBetween,
} from './dateCalculator.ts';
import { CarRepository } from './carRepository.ts';
import { EmailService } from './emailService.ts';
import { logger } from './logger.ts';
import { NotificationTask, ProcessingResult, DigestItem, UserProfile } from './types.ts';

/** One customer's set of due vehicles for this run — the unit of sending. */
interface CustomerDigest {
  userId: string;
  profile: UserProfile;
  items: DigestItem[];
}

serve(async (req) => {
  const startTime = Date.now();
  const executionId = crypto.randomUUID();

  logger.setExecutionId(executionId);
  logger.info('Edge function started', { executionId });

  if (req.method !== 'POST') {
    logger.warn('Invalid HTTP method', { method: req.method });
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Authorization is handled by Supabase's built-in JWT validation
  // Only authenticated requests with valid anon or service_role keys can reach this point
  logger.info('Request authenticated via Supabase JWT');

  try {
    // Verify environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const emailFrom = Deno.env.get('EMAIL_FROM');

    if (!supabaseUrl || !supabaseKey || !resendApiKey || !emailFrom) {
      logger.error('Missing required environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize services
    const repository = new CarRepository(supabaseUrl, supabaseKey);
    const emailService = new EmailService(resendApiKey, emailFrom);

    // Step 1: Calculate target dates (deterministic)
    const today = getTodayUTC();
    const targetDatesMap = calculateTargetDates();
    const targetDates = Array.from(targetDatesMap.values());

    logger.info('📅 Target dates calculated', {
      today: formatDateISO(today),
      intervals: Array.from(targetDatesMap.entries()).map(([type, date]) => ({
        type,
        date: formatDateISO(date),
      })),
    });

    // Step 2: Query cars expiring on target dates
    const cars = await repository.getCarsForNotification(targetDates);

    if (cars.length === 0) {
      logger.info('✅ No cars found for notification today');
      return createSuccessResponse({
        totalCars: 0,
        emailsSent: 0,
        emailsFailed: 0,
        alreadySent: 0,
        errors: [],
        executionTimeMs: Date.now() - startTime,
      });
    }

    logger.info(`📧 Processing ${cars.length} cars`, { totalCars: cars.length });

    // Step 3: Build notification tasks
    const tasks: NotificationTask[] = [];

    for (const car of cars) {
      const expiryDate = new Date(car.expiry_date);
      const daysUntilExpiry = daysBetween(today, expiryDate);

      // Find matching notification type by expiry date
      let notificationType: string | undefined;
      for (const [type, targetDate] of targetDatesMap) {
        if (formatDateISO(targetDate) === car.expiry_date) {
          notificationType = type;
          break;
        }
      }

      if (!notificationType) {
        logger.warn('⚠️  No notification type matched for car', {
          carId: car.id,
          expiryDate: car.expiry_date,
        });
        continue;
      }

      // Get user profile (email required)
      const profile = await repository.getUserProfile(car.user_id);
      if (!profile || !profile.email) {
        logger.warn('⚠️  User profile not found or missing email', {
          carId: car.id,
          userId: car.user_id,
        });
        await repository.logError('MISSING_USER_PROFILE', 'User profile missing email', {
          carId: car.id,
          userId: car.user_id,
          functionName: 'buildNotificationTasks',
          executionId,
        });
        continue;
      }

      // Check if notification already sent (idempotency)
      const alreadySent = await repository.isNotificationSent(
        car.id,
        notificationType as any,
        expiryDate
      );
      if (alreadySent) {
        logger.info('✓ Notification already sent, skipping', {
          carId: car.id,
          notificationType,
        });
        continue;
      }

      tasks.push({
        car,
        profile,
        notificationType: notificationType as any,
        expiryDate,
        daysUntilExpiry,
      });
    }

    logger.info(`🎯 Tasks prepared: ${tasks.length}/${cars.length}`, {
      totalTasks: tasks.length,
      alreadySent: cars.length - tasks.length,
    });

    if (tasks.length === 0) {
      logger.info('✅ All cars already notified or have issues');
      return createSuccessResponse({
        totalCars: cars.length,
        emailsSent: 0,
        emailsFailed: 0,
        alreadySent: cars.length,
        errors: [],
        executionTimeMs: Date.now() - startTime,
      });
    }

    // Step 4: Group by customer, then process in batches (rate limiting).
    // One customer receives one email per run no matter how many of their
    // vehicles are due — see buildDigests.
    const digests = buildDigests(tasks);

    logger.info(`👥 Grouped into ${digests.length} customer digest(s)`, {
      customers: digests.length,
      vehicles: tasks.length,
    });

    const result = await processBatches(
      digests,
      repository,
      emailService,
      executionId
    );

    result.executionTimeMs = Date.now() - startTime;

    logger.info('✅ Processing complete', {
      totalCars: result.totalCars,
      emailsSent: result.emailsSent,
      emailsFailed: result.emailsFailed,
      executionTimeMs: result.executionTimeMs,
    });

    return createSuccessResponse(result);
  } catch (error) {
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;

    logger.error('❌ Edge function failed', {
      error: errorMessage,
      stack: errorStack,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Process notification tasks in batches with rate limiting
 * 
 * Respects Resend API rate limits by processing in batches
 * of 50 with 1-second delays between batches.
 */
async function processBatches(
  digests: CustomerDigest[],
  repository: CarRepository,
  emailService: EmailService,
  executionId: string
): Promise<ProcessingResult> {
  const totalCars = digests.reduce((sum, d) => sum + d.items.length, 0);

  const result: ProcessingResult = {
    totalCars,
    emailsSent: 0,
    emailsFailed: 0,
    alreadySent: 0,
    errors: [],
    executionTimeMs: 0,
  };

  const batchSize = CONFIG.RATE_LIMIT.BATCH_SIZE;
  const totalBatches = Math.ceil(digests.length / batchSize);

  // Process in batches to respect rate limits
  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const startIdx = batchNum * batchSize;
    const endIdx = Math.min(startIdx + batchSize, digests.length);
    const batch = digests.slice(startIdx, endIdx);

    logger.info(`📦 Processing batch ${batchNum + 1}/${totalBatches}`, {
      batchNumber: batchNum + 1,
      batchSize: batch.length,
      total: digests.length,
    });

    // Process batch digests concurrently
    const batchPromises = batch.map(digest =>
      processDigest(digest, repository, emailService, executionId)
    );
    const batchResults = await Promise.allSettled(batchPromises);

    // Aggregate batch results. Counts are per email, not per car, so a customer
    // with 12 due vehicles counts as one send — errors still name every car so
    // nothing is lost when chasing a failure.
    for (let i = 0; i < batchResults.length; i++) {
      const digestResult = batchResults[i];
      const digest = batch[i];

      if (digestResult.status === 'fulfilled' && digestResult.value.success) {
        result.emailsSent++;
      } else {
        result.emailsFailed++;
        const error = digestResult.status === 'fulfilled'
          ? (digestResult.value.error || 'Unknown error')
          : (digestResult.reason?.message || 'Digest rejected');
        for (const item of digest.items) {
          result.errors.push({ carId: item.car.id, error });
        }
      }
    }

    // Delay between batches (rate limiting)
    if (batchNum < totalBatches - 1) {
      logger.debug('⏸️  Rate limiting delay', {
        delayMs: CONFIG.RATE_LIMIT.BATCH_DELAY_MS,
      });
      await sleep(CONFIG.RATE_LIMIT.BATCH_DELAY_MS);
    }
  }

  return result;
}

/**
 * Collapse per-car tasks into one digest per customer.
 *
 * Keyed on user_id rather than email so two accounts sharing an address are not
 * silently merged into one send.
 */
function buildDigests(tasks: NotificationTask[]): CustomerDigest[] {
  const byUser = new Map<string, CustomerDigest>();

  for (const task of tasks) {
    const key = task.car.user_id;
    const existing = byUser.get(key);

    const item: DigestItem = {
      car: task.car,
      notificationType: task.notificationType,
      expiryDate: task.expiryDate,
      daysUntilExpiry: task.daysUntilExpiry,
    };

    if (existing) {
      existing.items.push(item);
    } else {
      byUser.set(key, { userId: key, profile: task.profile, items: [item] });
    }
  }

  return [...byUser.values()];
}

// ─── WhatsApp helper (Deno-native, no npm) ───────────────────────────────────
/**
 * Sends the motoka_expiry_reminder WhatsApp template via Twilio REST API.
 *
 * Uses Twilio's Content Template API (ContentSid + ContentVariables) — the same
 * Meta-approved template used by the Node.js whatsapp.service.js. Calls the
 * Twilio Messages REST API directly via fetch because the Node.js Twilio SDK is
 * not available in Deno Edge Functions.
 *
 * Template: motoka_expiry_reminder
 * {{1}} name · {{2}} registrationNo · {{3}} daysRemaining · {{4}} expiryDate · {{5}} renewalUrl
 *
 * This function is intentionally fire-and-forget (not awaited at call site) and
 * must never propagate errors — a WhatsApp failure must never block the main
 * email/cron notification flow.
 */
async function sendExpiryReminderWhatsApp(
  phone: string,
  name: string,
  registrationNo: string,
  daysUntilExpiry: number,
  expiryDate: Date,
  renewalUrl: string
): Promise<void> {
  const enabled     = Deno.env.get('WHATSAPP_REMINDERS_ENABLED') === 'true';
  const accountSid  = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken   = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber  = Deno.env.get('TWILIO_WHATSAPP_FROM');
  const contentSid  = Deno.env.get('TWILIO_TEMPLATE_EXPIRY_REMINDER');

  if (!enabled) return;

  if (!phone || !accountSid || !authToken || !fromNumber || !contentSid) {
    logger.info('[WhatsApp] Skipping expiry reminder — missing credentials, phone, or template SID', {
      hasPhone:       Boolean(phone),
      hasCredentials: Boolean(accountSid && authToken && fromNumber),
      hasTemplate:    Boolean(contentSid),
    });
    return;
  }

  try {
    const expiryDateStr = expiryDate.toISOString().split('T')[0];

    const url         = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = btoa(`${accountSid}:${authToken}`);

    const contentVariables = JSON.stringify({
      '1': name,
      '2': registrationNo,
      '3': String(daysUntilExpiry),
      '4': expiryDateStr,
      '5': renewalUrl,
    });

    const formData = new URLSearchParams({
      From:             `whatsapp:${fromNumber}`,
      To:               `whatsapp:${phone}`,
      ContentSid:       contentSid,
      ContentVariables: contentVariables,
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      logger.warn('[WhatsApp] Twilio API returned error (non-blocking)', {
        status: resp.status,
        body:   errText,
        phone,
        registrationNo,
      });
    } else {
      logger.info('[WhatsApp] Expiry reminder sent', { phone, registrationNo, daysUntilExpiry });
    }
  } catch (err) {
    // Never propagate — WhatsApp failure must never break the email/cron flow
    logger.warn('[WhatsApp] Failed to send expiry reminder (non-blocking)', {
      error: (err as Error).message,
      phone,
      registrationNo,
    });
  }
}

/**
 * Process one customer's digest
 *
 * Sends a single email covering all of their due vehicles, then records history
 * for each vehicle individually so idempotency stays per (car, stage, expiry) —
 * exactly as before. History is only written after a successful send, so a
 * failed digest is retried in full on the next run rather than leaving some
 * vehicles marked as notified.
 */
async function processDigest(
  digest: CustomerDigest,
  repository: CarRepository,
  emailService: EmailService,
  executionId: string
): Promise<{ success: boolean; error?: string }> {
  const { profile, items } = digest;
  const primary = items[0];

  try {
    const emailResult = await emailService.sendExpiryDigest(profile, items);

    if (!emailResult.success) {
      for (const item of items) {
        await repository.logError('EMAIL_SEND_FAILED', emailResult.error || 'Unknown error', {
          carId: item.car.id,
          userId: item.car.user_id,
          notificationType: item.notificationType,
          functionName: 'sendExpiryDigest',
          executionId,
          retryCount: emailResult.retryCount,
        });
      }
      return { success: false, error: emailResult.error };
    }

    // WhatsApp expiry reminder — fire alongside email, does NOT replace it.
    // One message per customer using their most urgent vehicle; the approved
    // template only has room for a single registration number.
    const renewalUrl =
      Deno.env.get('PAYMENT_CANCEL_URL') ||
      `${Deno.env.get('FRONTEND_URL') || 'https://app.motoka.ng'}/licenses/renew`;
    const mostUrgent = items.reduce(
      (worst, item) => (item.daysUntilExpiry < worst.daysUntilExpiry ? item : worst),
      primary
    );
    sendExpiryReminderWhatsApp(
      (profile as any).phone_number || '',
      profile.first_name || 'User',
      mostUrgent.car.registration_no || '',
      mostUrgent.daysUntilExpiry,
      mostUrgent.expiryDate,
      renewalUrl
    ); // intentionally not awaited — must not block or fail the main email flow

    // Record every vehicle covered by this email
    for (const item of items) {
      await repository.recordNotification(
        item.car.id,
        item.car.user_id,
        item.notificationType,
        item.expiryDate,
        profile.email,
        emailResult.emailId
      );
    }

    return { success: true };
  } catch (error) {
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;

    logger.error('❌ Digest processing failed', {
      userId: digest.userId,
      vehicles: items.length,
      error: errorMessage,
    });

    await repository.logError('TASK_PROCESSING_ERROR', errorMessage, {
      carId: primary.car.id,
      userId: primary.car.user_id,
      notificationType: primary.notificationType,
      errorStack,
      functionName: 'processDigest',
      executionId,
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * Create successful response
 */
function createSuccessResponse(result: ProcessingResult): Response {
  return new Response(
    JSON.stringify({
      success: true,
      ...result,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Sleep helper for rate limiting delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
