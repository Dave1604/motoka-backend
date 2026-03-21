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
import { NotificationTask, ProcessingResult } from './types.ts';

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

    // Step 4: Process in batches (rate limiting)
    const result = await processBatches(
      tasks,
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
  tasks: NotificationTask[],
  repository: CarRepository,
  emailService: EmailService,
  executionId: string
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    totalCars: tasks.length,
    emailsSent: 0,
    emailsFailed: 0,
    alreadySent: 0,
    errors: [],
    executionTimeMs: 0,
  };

  const batchSize = CONFIG.RATE_LIMIT.BATCH_SIZE;
  const totalBatches = Math.ceil(tasks.length / batchSize);

  // Process in batches to respect rate limits
  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const startIdx = batchNum * batchSize;
    const endIdx = Math.min(startIdx + batchSize, tasks.length);
    const batch = tasks.slice(startIdx, endIdx);

    logger.info(`📦 Processing batch ${batchNum + 1}/${totalBatches}`, {
      batchNumber: batchNum + 1,
      batchSize: batch.length,
      total: tasks.length,
    });

    // Process batch tasks concurrently
    const batchPromises = batch.map(task =>
      processTask(task, repository, emailService, executionId)
    );
    const batchResults = await Promise.allSettled(batchPromises);

    // Aggregate batch results
    for (let i = 0; i < batchResults.length; i++) {
      const taskResult = batchResults[i];
      const task = batch[i];

      if (taskResult.status === 'fulfilled') {
        if (taskResult.value.success) {
          result.emailsSent++;
        } else {
          result.emailsFailed++;
          result.errors.push({
            carId: task.car.id,
            error: taskResult.value.error || 'Unknown error',
          });
        }
      } else {
        result.emailsFailed++;
        result.errors.push({
          carId: task.car.id,
          error: taskResult.reason?.message || 'Task rejected',
        });
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
 * Process a single notification task
 * 
 * Sends email and records in history for idempotency.
 */
async function processTask(
  task: NotificationTask,
  repository: CarRepository,
  emailService: EmailService,
  executionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Send email with retry logic
    const emailResult = await emailService.sendExpiryNotification(
      task.car,
      task.profile,
      task.notificationType,
      task.daysUntilExpiry
    );

    if (!emailResult.success) {
      // Log error to database
      await repository.logError('EMAIL_SEND_FAILED', emailResult.error || 'Unknown error', {
        carId: task.car.id,
        userId: task.car.user_id,
        notificationType: task.notificationType,
        functionName: 'sendExpiryNotification',
        executionId,
        retryCount: emailResult.retryCount,
      });

      return { success: false, error: emailResult.error };
    }

    // WhatsApp expiry reminder — fire alongside email, does NOT replace it
    // Uses the profile.phone field; silently skips if missing or feature-flagged off
    // PAYMENT_CANCEL_URL already points to the renewal page (e.g. https://app.motoka.ng/licenses/renew)
    const renewalUrl =
      Deno.env.get('PAYMENT_CANCEL_URL') ||
      `${Deno.env.get('FRONTEND_URL') || 'https://app.motoka.ng'}/licenses/renew`;
    sendExpiryReminderWhatsApp(
      (task.profile as any).phone_number || '',
      task.profile.firstName || 'User',
      task.car.registration_no || '',
      task.daysUntilExpiry,
      task.expiryDate,
      renewalUrl
    ); // intentionally not awaited — must not block or fail the main email flow

    // Record in history (transaction) for idempotency
    await repository.recordNotification(
      task.car.id,
      task.car.user_id,
      task.notificationType,
      task.expiryDate,
      task.profile.email,
      emailResult.emailId
    );

    return { success: true };
  } catch (error) {
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;

    logger.error('❌ Task processing failed', {
      carId: task.car.id,
      error: errorMessage,
    });

    await repository.logError('TASK_PROCESSING_ERROR', errorMessage, {
      carId: task.car.id,
      userId: task.car.user_id,
      notificationType: task.notificationType,
      errorStack,
      functionName: 'processTask',
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
