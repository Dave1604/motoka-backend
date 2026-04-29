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

// Send pre-charge notification at this many days before expiry
const PRE_CHARGE_NOTIFY_DAYS = 30;

function isCardExpired(card_exp_month, card_exp_year) {
  if (!card_exp_month || !card_exp_year) return false;
  const today = new Date();
  const year = parseInt(card_exp_year, 10);
  const month = parseInt(card_exp_month, 10);
  // Card is valid through the last day of the expiry month
  if (today.getFullYear() > year) return true;
  if (today.getFullYear() === year && today.getMonth() + 1 > month) return true;
  return false;
}

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
 * Find subscriptions where the car expires in ~30 days and send a heads-up
 * notification if we haven't done so yet. Stores a flag in metadata so the
 * notification only fires once per billing cycle.
 */
async function sendPreChargeNotifications() {
  const supabaseAdmin = getSupabaseAdmin();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: subscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select(`*, cars:car_id (id, vehicle_make, vehicle_model, registration_no, expiry_date)`)
    .eq('status', SUBSCRIPTION_STATUS.ACTIVE)
    .not('authorization_code', 'is', null);

  if (error || !subscriptions?.length) return;

  for (const sub of subscriptions) {
    if (!sub.cars?.expiry_date) continue;

    const expiry = new Date(sub.cars.expiry_date);
    expiry.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.round((expiry - today) / (1000 * 60 * 60 * 24));

    // Notify in the 28–31 day window (to handle daily job timing drift)
    if (daysUntilExpiry < 28 || daysUntilExpiry > 31) continue;

    // Skip if already notified this cycle
    if (sub.metadata?.pre_charge_notified_at) {
      const notifiedAt = new Date(sub.metadata.pre_charge_notified_at);
      const daysSinceNotify = Math.round((today - notifiedAt) / (1000 * 60 * 60 * 24));
      if (daysSinceNotify < 60) continue; // already notified in this renewal cycle
    }

    const car = sub.cars;
    const label = `${car.vehicle_make} ${car.vehicle_model} (${car.registration_no})`;
    const chargeDate = new Date(expiry);
    chargeDate.setDate(chargeDate.getDate() - 14);
    const chargeDateStr = chargeDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
    const nairaAmount = (sub.amount / 100).toLocaleString('en-NG');

    try {
      await createInAppNotification(
        sub.user_id,
        'payment',
        'auto_renewal_upcoming',
        `Heads up! Auto-renewal for ${label} is coming up. We'll charge ₦${nairaAmount} on ${chargeDateStr}.`
      );

      // Mark as notified in metadata
      const updatedMeta = { ...(sub.metadata || {}), pre_charge_notified_at: new Date().toISOString() };
      await supabaseAdmin
        .from('subscriptions')
        .update({ metadata: updatedMeta })
        .eq('id', sub.id);

      logInfo('[AutoBilling] Pre-charge notification sent', { subscriptionId: sub.id, daysUntilExpiry });
    } catch (err) {
      logError('[AutoBilling] Failed to send pre-charge notification', { error: err.message, subscriptionId: sub.id });
    }
  }
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

  // Guard: skip charge and notify user if their saved card has expired
  if (isCardExpired(sub.card_exp_month, sub.card_exp_year)) {
    logWarn('[AutoBilling] Saved card is expired — skipping charge, notifying user', {
      subscriptionId: sub.id
    });
    await notifyExpiredCard(sub);
    return;
  }

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

async function notifyExpiredCard(sub) {
  const car = sub.cars;
  const label = `${car.vehicle_make} ${car.vehicle_model} (${car.registration_no})`;
  try {
    await createInAppNotification(
      sub.user_id,
      'payment',
      'card_expired',
      `Your saved card for ${label} has expired. Please update it in Settings → Auto Renewal so we can renew your documents.`
    );
  } catch (err) {
    logError('[AutoBilling] Failed to send expired card notification', { error: err.message });
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
    // Send 30-day heads-up notifications before checking charges
    await sendPreChargeNotifications().catch(err =>
      logError('[AutoBilling] Pre-charge notification run failed', { error: err.message })
    );

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
