/**
 * Email + in-app notifications for Ladipo orders (non-blocking).
 */

import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import { formatAmount } from '../../utils/paymentHelpers.js';
import { createInAppNotification } from '../notification.service.js';
import {
  sendLadipoOrderCreatedEmail,
  sendLadipoCancelledEmail,
  sendLadipoDeliveredEmail,
  sendLadipoOrderProcessingEmail,
  sendLadipoOutForDeliveryEmail,
  sendLadipoPaymentSuccessEmail,
  sendLadipoPaymentFailedEmail,
} from '../email/ladipoOrderEmail.service.js';

async function getProfileForUser(authUserId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('profiles')
    .select('email, first_name')
    .eq('id', authUserId)
    .single();
  if (error || !data?.email) return null;
  return data;
}

export async function notifyLadipoOrderCreated(userId, order) {
  try {
    const totalLabel = formatAmount(order.total_kobo);
    const message = `Ladipo order ${order.order_number} created (${totalLabel}). Complete payment when you're ready.`;
    await createInAppNotification(userId, 'payment', 'ladipo_order_created', message, {
      order_number: order.order_number,
      ladipo: true,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderCreated in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoOrderCreatedEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
      });
    }
    logInfo('[Ladipo] Order created notifications sent', { order_number: order.order_number });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderCreated email failed', err);
  }
}

export async function notifyLadipoPaymentSuccess(userId, order) {
  try {
    const totalLabel = formatAmount(order.total_kobo);
    const message = `Payment successful for Ladipo order ${order.order_number} (${totalLabel}). We're processing your parts.`;
    await createInAppNotification(userId, 'payment', 'ladipo_payment_success', message, {
      order_number: order.order_number,
      ladipo: true,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoPaymentSuccess in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoPaymentSuccessEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
      });
    }
    logInfo('[Ladipo] Payment success notifications sent', { order_number: order.order_number });
  } catch (err) {
    logError('[Ladipo] notifyLadipoPaymentSuccess email failed', err);
  }
}

export async function notifyLadipoPaymentFailed(userId, order, reasonKey = 'verification') {
  const reasonLabel =
    reasonKey === 'amount_mismatch'
      ? 'amount mismatch'
      : reasonKey === 'gateway'
        ? 'payment declined'
        : 'verification failed';
  try {
    const message = `Payment for Ladipo order ${order.order_number} could not be confirmed. You can try again from the marketplace.`;
    await createInAppNotification(userId, 'warning', 'ladipo_payment_failed', message, {
      order_number: order.order_number,
      ladipo: true,
      reason: reasonKey,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoPaymentFailed in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoPaymentFailedEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
        reasonLabel,
      });
    }
    logInfo('[Ladipo] Payment failure notifications sent', {
      order_number: order.order_number,
      reasonKey,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoPaymentFailed email failed', err);
  }
}

export async function notifyLadipoOrderProcessing(userId, order) {
  try {
    const message = `Your Ladipo order ${order.order_number} is now being processed.`;
    await createInAppNotification(userId, 'order', 'ladipo_order_processing', message, {
      order_number: order.order_number,
      ladipo: true,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderProcessing in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoOrderProcessingEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
      });
    }
    logInfo('[Ladipo] Processing notifications sent', { order_number: order.order_number });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderProcessing email failed', err);
  }
}

export async function notifyLadipoOrderOutForDelivery(userId, order) {
  const isPickup = String(order?.delivery?.method || '').toLowerCase() === 'pickup';
  const message = isPickup
    ? `Your Ladipo order ${order.order_number} is ready for pickup.`
    : `Your Ladipo order ${order.order_number} is now out for delivery.`;
  const eventType = isPickup ? 'ladipo_order_ready_for_pickup' : 'ladipo_order_out_for_delivery';
  try {
    await createInAppNotification(userId, 'order', eventType, message, {
      order_number: order.order_number,
      ladipo: true,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderOutForDelivery in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoOutForDeliveryEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
      });
    }
    logInfo('[Ladipo] Out-for-delivery notifications sent', { order_number: order.order_number });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderOutForDelivery email failed', err);
  }
}

export async function notifyLadipoOrderDelivered(userId, order) {
  try {
    const message = `Your Ladipo order ${order.order_number} has been delivered successfully.`;
    await createInAppNotification(userId, 'order', 'ladipo_order_delivered', message, {
      order_number: order.order_number,
      ladipo: true,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderDelivered in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoDeliveredEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
      });
    }
    logInfo('[Ladipo] Delivered notifications sent', { order_number: order.order_number });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderDelivered email failed', err);
  }
}

export async function notifyLadipoOrderCancelled(userId, order, reason) {
  try {
    const message = `Your Ladipo order ${order.order_number} was cancelled. Reason: ${reason}`;
    await createInAppNotification(userId, 'warning', 'ladipo_order_cancelled', message, {
      order_number: order.order_number,
      ladipo: true,
      reason,
    });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderCancelled in-app failed', err);
  }
  try {
    const profile = await getProfileForUser(userId);
    if (profile?.email) {
      await sendLadipoCancelledEmail({
        to: profile.email,
        firstName: profile.first_name,
        order,
        reason,
      });
    }
    logInfo('[Ladipo] Cancelled notifications sent', { order_number: order.order_number });
  } catch (err) {
    logError('[Ladipo] notifyLadipoOrderCancelled email failed', err);
  }
}
