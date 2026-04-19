/**
 * AUTO-BILLING SERVICE
 *
 * Runs on a schedule (registered in index.js) to charge subscriptions
 * before their car's document expiry date.
 *
 * Attempt schedule (relative to car expiry_date):
 *   Attempt 1 — 14 days before expiry
 *   Attempt 2 —  7 days before expiry (if attempt 1 failed)
 *   Attempt 3 —  3 days before expiry (if attempts 1–2 failed)
 *
 * After 3 failures, subscription is paused and user is notified via WhatsApp.
 */

import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo, logWarn } from '../../utils/logger.js';
import { chargeAuthorization } from '../payment/paystack.service.js';
import { generatePaymentReference } from '../../utils/paymentHelpers.js';
import { createInAppNotification } from '../notification.service.js';
import {
  SUBSCRIPTION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TYPE
} from '../../constants/payment.constants.js';

// Days before expiry to attempt each charge
const ATTEMPT_WINDOWS = [14, 7, 3];
const MAX_RETRIES = ATTEMPT_WINDOWS.length;

/**
 * Get subscriptions that are due for a billing attempt today.
 *
 * A subscription is due if the car's expiry_date falls within one of the
 * attempt windows AND the current retry_count maps to that window.
 *
 * retry_count 0 → charge at 14 days before expiry
 * retry_count 1 → charge at  7 days before expiry
 * retry_count 2 → charge at  3 days before expiry
 */
async function getSubscriptionsDueToday() {
  const supabaseAdmin = getSupabaseAdmin();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: subscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date
      )
    `)
    .eq('status', SUBSCRIPTION_STATUS.ACTIVE)
    .not('authorization_code', 'is', null)
    .lt('retry_count', MAX_RETRIES);

  if (error) {
    logError('[AutoBilling] Failed to fetch subscriptions', { error });
    return [];
  }

  const due = [];

  for (const sub of subscriptions || []) {
    if (!sub.cars?.expiry_date) continue;

    const expiry = new Date(sub.cars.expiry_date);
    expiry.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.round((expiry - today) / (1000 * 60 * 60 * 24));

    const attemptWindow = ATTEMPT_WINDOWS[sub.retry_count] ?? null;
    if (attemptWindow === null) continue;

    // Due today if we're at or past the attempt window
    if (daysUntilExpiry <= attemptWindow) {
      // Don't re-attempt if we already tried today
      if (sub.last_retry_at) {
        const lastRetry = new Date(sub.last_retry_at);
        lastRetry.setHours(0, 0, 0, 0);
        if (lastRetry.getTime() === today.getTime()) continue;
      }
      due.push({ sub, daysUntilExpiry });
    }
  }

  return due;
}

/**
 * Charge a single subscription.
 * On success: update billing dates and reset retry_count.
 * On failure: increment retry_count; if max retries hit, pause and notify.
 */
async function chargeSubscription(sub, daysUntilExpiry) {
  const supabaseAdmin = getSupabaseAdmin();
  const reference = generatePaymentReference();

  logInfo('[AutoBilling] Attempting charge', {
    subscriptionId: sub.id,
    carSlug: sub.cars?.slug,
    daysUntilExpiry,
    attempt: sub.retry_count + 1
  });

  try {
    const result = await chargeAuthorization({
      authorization_code: sub.authorization_code,
      email: sub.email,
      amount: sub.amount,
      reference,
      metadata: {
        subscription_id: sub.id,
        subscription_code: sub.subscription_code,
        car_id: sub.car_id,
        is_auto_renewal: true,
        renewal_document_ids: sub.renewal_document_ids || []
      }
    });

    if (result.status === 'success') {
      // Update billing dates and reset retry counter
      const nextExpiry = new Date(sub.cars.expiry_date);
      nextExpiry.setFullYear(nextExpiry.getFullYear() + 1);
      const nextBillingDate = nextExpiry.toISOString().split('T')[0];

      await supabaseAdmin
        .from('subscriptions')
        .update({
          last_billing_date: new Date().toISOString().split('T')[0],
          next_billing_date: nextBillingDate,
          retry_count: 0,
          last_retry_at: null
        })
        .eq('id', sub.id);

      // Extend the car's expiry date by one year
      await supabaseAdmin
        .from('cars')
        .update({ expiry_date: nextBillingDate, updated_at: new Date().toISOString() })
        .eq('id', sub.car_id);

      // Record transaction
      await supabaseAdmin.from('payment_transactions').insert({
        reference,
        user_id: sub.user_id,
        car_id: sub.car_id,
        amount: sub.amount,
        status: PAYMENT_STATUS.SUCCESSFUL,
        payment_type: PAYMENT_TYPE.RENEWAL_AUTO,
        payment_gateway: 'paystack',
        metadata: {
          subscription_id: sub.id,
          is_auto_renewal: true,
          renewal_document_ids: sub.renewal_document_ids || []
        },
        paid_at: new Date().toISOString()
      });

      logInfo('[AutoBilling] Charge successful', {
        subscriptionId: sub.id,
        reference
      });

      // Notify user of successful renewal
      await notifySuccess(sub);
    } else {
      await handleFailedAttempt(sub);
    }
  } catch (err) {
    logError('[AutoBilling] Charge error', {
      subscriptionId: sub.id,
      error: err.message
    });
    await handleFailedAttempt(sub);
  }
}

async function handleFailedAttempt(sub) {
  const supabaseAdmin = getSupabaseAdmin();
  const newRetryCount = (sub.retry_count || 0) + 1;

  if (newRetryCount >= MAX_RETRIES) {
    // Max retries hit — pause subscription and notify
    await supabaseAdmin
      .from('subscriptions')
      .update({
        status: SUBSCRIPTION_STATUS.PAUSED,
        retry_count: newRetryCount,
        last_retry_at: new Date().toISOString(),
        paused_at: new Date().toISOString()
      })
      .eq('id', sub.id);

    logWarn('[AutoBilling] Max retries hit — subscription paused', {
      subscriptionId: sub.id
    });

    await notifyPaymentFailed(sub);
  } else {
    await supabaseAdmin
      .from('subscriptions')
      .update({
        retry_count: newRetryCount,
        last_retry_at: new Date().toISOString()
      })
      .eq('id', sub.id);

    logInfo('[AutoBilling] Attempt failed, will retry', {
      subscriptionId: sub.id,
      attempt: newRetryCount,
      nextWindow: `${ATTEMPT_WINDOWS[newRetryCount]} days before expiry`
    });
  }
}

async function notifySuccess(sub) {
  const car = sub.cars;
  const label = `${car.vehicle_make} ${car.vehicle_model} (${car.registration_no})`;
  try {
    await createInAppNotification(
      sub.user_id,
      'payment',
      'auto_renewal_success',
      `Auto-renewal successful for ${label}. Your documents are renewed for another year.`
    );
  } catch (err) {
    logError('[AutoBilling] Failed to send success notification', { error: err.message });
  }
}

async function notifyPaymentFailed(sub) {
  const car = sub.cars;
  const label = `${car.vehicle_make} ${car.vehicle_model} (${car.registration_no})`;
  try {
    await createInAppNotification(
      sub.user_id,
      'payment',
      'auto_renewal_failed',
      `Auto-renewal failed for ${label} after 3 attempts. Please update your card in Settings → Auto Renewal.`
    );
  } catch (err) {
    logError('[AutoBilling] Failed to send failure notification', { error: err.message });
  }
}

/**
 * Main entry point — called by the scheduler in index.js.
 */
export async function runAutoBillingJob() {
  logInfo('[AutoBilling] Job started');

  let processed = 0;
  let failed = 0;

  try {
    const dueSubscriptions = await getSubscriptionsDueToday();
    logInfo('[AutoBilling] Subscriptions due today', { count: dueSubscriptions.length });

    for (const { sub, daysUntilExpiry } of dueSubscriptions) {
      try {
        await chargeSubscription(sub, daysUntilExpiry);
        processed++;
      } catch (err) {
        failed++;
        logError('[AutoBilling] Unexpected error processing subscription', {
          subscriptionId: sub.id,
          error: err.message
        });
      }
    }
  } catch (err) {
    logError('[AutoBilling] Job failed', { error: err.message });
  }

  logInfo('[AutoBilling] Job complete', { processed, failed });
}
