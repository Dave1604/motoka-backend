import { logError, logDebug, logInfo, logWarn } from '../../utils/logger.js';
import paymentMetrics from '../../services/payment/metrics.service.js';
import { GatewayFactory } from '../../services/payment/gateway/gateway.factory.js';
import {
  getTransactionByReference,
  getTransactionByPaystackReference,
  getTransactionByMonicreditOrderId,
  getTransactionByWebhookEventId,
  updateTransactionStatus,
  updateTransactionWebhookEventId,
  processPaymentSuccess,
  TransactionError
} from '../../services/payment/transaction.service.js';
import {
  getOrderById,
  getOrderByTransactionId,
  OrderError
} from '../../services/payment/order.service.js';
import {
  validatePaymentAmount,
  AmountValidationError
} from '../../services/payment/validation/amount.validator.js';
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  PAYMENT_GATEWAY,
  ORDER_TYPE,
  PAYSTACK_EVENTS,
  PAYMENT_LIMITS,
  ERROR_MESSAGES
} from '../../constants/payment.constants.js';
import { PaymentSuccessService } from '../../services/payment/payment-success.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { sendPaymentFailedEmail } from '../../services/email/paymentEmail.service.js';
import { createInAppNotification } from '../../services/notification.service.js';
import { formatAmount } from '../../utils/paymentHelpers.js';
import { parseWebhookEvent, verifyTransaction as paystackVerifyTransaction, createRefund } from '../../services/payment/paystack.service.js';
import { activateSubscription } from '../../services/payment/subscription.service.js';
import { generateMonicreditEventId } from '../../services/payment/monicredit/monicredit.service.js';
import { MonicreditAdapter } from '../../services/payment/monicredit/index.js';
import { logPaymentAudit } from '../../services/payment/audit.service.js';
import { markGuestOrderPaid, markGuestOrderFailed } from '../../services/guest/guestRenewal.service.js';
import {
  verifyAndFulfillOrder as fulfillLadipoOrder,
  markLadipoOrderPaymentFailed,
} from '../../services/ladipo/ladipo.service.js';

// POST /api/webhooks/paystack
export const handlePaystackWebhook = async (req, res) => {
  try {
    // Signature verified by middleware
    const { event, data, eventId } = parseWebhookEvent(req.body);
    
    logDebug('[Paystack Webhook] Received event', { event, eventId, reference: data?.reference });
    
    switch (event) {
      case PAYSTACK_EVENTS.CHARGE_SUCCESS:
        await handleChargeSuccess(data, eventId);
        break;
      case PAYSTACK_EVENTS.CHARGE_FAILED:
        await handleChargeFailed(data, eventId);
        break;
      default:
        logInfo('[Webhook] Unhandled event:', event);
    }
    
    return res.status(200).json({ received: true });
    
  } catch (error) {
    logError('Webhook processing error', error);
    // Always 200 — prevent Paystack from retrying on our internal errors
    const isProduction = process.env.NODE_ENV === 'production';
    return res.status(200).json({
      received: true,
      ...(isProduction ? {} : { error: error.message })
    });
  }
};

// POST /api/webhooks/monicredit
export const handleMonicreditWebhook = async (req, res) => {
  const webhookStartTime = Date.now();
  let signatureVerified = false;
  
  try {
    // express.raw() gives us a Buffer — parse to JSON before reading fields
    let webhookData;
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
      webhookData = JSON.parse(raw);
    } catch {
      logError('[Monicredit Webhook] Failed to parse JSON body');
      return res.status(400).json({ received: false, error: 'Invalid JSON payload' });
    }

    // Support both event-keyed { event, data } and flat { status, order_id } payload shapes
    const event = webhookData.event || webhookData.type;
    const data = webhookData.data || webhookData;
    
    // Signature already verified by verifyMonicreditWebhook middleware
    signatureVerified = true;
    paymentMetrics.trackWebhook({
      signatureVerified,
      isDuplicate: false,
      processingTime: Date.now() - webhookStartTime
    });
    
    logInfo('[Monicredit Webhook] Processing event', {
      event,
      order_id: data?.order_id || webhookData?.order_id,
      status: webhookData?.status
    });
    
    if (event === 'payment.success' || event === 'charge.success' || webhookData.status === 'success' || webhookData.status === 'approved') {
      await handleMonicreditPaymentSuccess(data);
      paymentMetrics.trackWebhookSuccess();
    } else if (event === 'payment.failed' || event === 'charge.failed' || webhookData.status === 'failed') {
      await handleMonicreditPaymentFailed(data);
      paymentMetrics.trackWebhookFailure();
    } else {
      logWarn('[Monicredit Webhook] Unhandled event', {
        event,
        order_id: data?.order_id || webhookData?.order_id
      });
      paymentMetrics.trackWebhookFailure();
    }
    
    return res.status(200).json({ received: true });
    
  } catch (error) {
    logError('Monicredit webhook processing error', error);
    
    paymentMetrics.trackWebhook({
      signatureVerified,
      isDuplicate: false,
      processingTime: Date.now() - webhookStartTime
    });
    paymentMetrics.trackWebhookFailure();
    
    // Always 200 — prevent Monicredit from retrying on our internal errors
    const isProduction = process.env.NODE_ENV === 'production';
    return res.status(200).json({
      received: true,
      ...(isProduction ? {} : { error: error.message })
    });
  }
};

async function handleChargeSuccess(data, eventId) {
  const reference = data.reference;
  
  logDebug('[Webhook] Processing charge.success', { reference, eventId });
  
  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      logDebug('[Webhook] Duplicate event, already processed', { eventId });
      return;
    }
  }
  
  let transaction = await getTransactionByPaystackReference(reference);
  if (!transaction) transaction = await getTransactionByReference(reference);
  
  if (!transaction) {
    // Check if this is a guest renewal order before giving up
    const guestOrder = await markGuestOrderPaid(reference);
    if (guestOrder) {
      logInfo('[Paystack Webhook] Guest order marked as paid', { reference, orderId: guestOrder.id });
      return;
    }

    // Check if this is a Ladipo marketplace order
    try {
      const ladipoOrder = await fulfillLadipoOrder(reference);
      if (ladipoOrder) {
        logInfo('[Paystack Webhook] Ladipo order fulfilled via webhook', { reference, order_number: ladipoOrder.order_number });
        return;
      }
    } catch (ladipoErr) {
      logError('[Paystack Webhook] Ladipo fulfillment error (non-fatal)', { reference, error: ladipoErr.message });
    }

    logError('Transaction not found for webhook', { reference });
    return;
  }
  
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Webhook] Transaction already processed', { reference });
    return;
  }

  // If the transaction was abandoned (user re-initiated payment) but the user still
  // completed payment on the original link, recover it so the RPC can create the order
  if (transaction.status === PAYMENT_STATUS.ABANDONED) {
    logWarn('[Webhook] Payment received for abandoned transaction — recovering', { reference });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.PENDING });
    transaction = await getTransactionByReference(reference);
  }

  // Store event ID before processing — prevents race conditions where two
  // concurrent webhooks both pass the duplicate check above
  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
    } catch (error) {
      if (error.code === '23505') {
        logDebug('[Webhook] Duplicate event (unique constraint)', { eventId });
        return;
      }
      logError('Failed to store webhook event ID', { error, reference, eventId });
    }
  }
  
  // Industry standard: verify with Paystack API before crediting (defense in depth)
  // Webhook signature proves origin, but API verify confirms payment state
  try {
    const verifyRef = transaction.paystack_reference || reference;
    const verifyResult = await paystackVerifyTransaction(verifyRef);
    if (verifyResult.status !== 'success') {
      logError('[Paystack Webhook] Verify returned non-success', { reference, status: verifyResult.status });
      await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
      return;
    }
    if (typeof verifyResult.amount === 'number' && verifyResult.amount !== transaction.amount) {
      logError('[Paystack Webhook] Verify amount mismatch', {
        reference,
        expected: transaction.amount,
        actual: verifyResult.amount
      });
      await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
      return;
    }
  } catch (verifyErr) {
    logError('[Paystack Webhook] Verify failed', { reference, error: verifyErr.message });
    return; // Don't process if we can't verify - Paystack will retry webhook
  }

  if (typeof data.amount === 'number') {
    if (data.amount < PAYMENT_LIMITS.MIN_AMOUNT || data.amount > PAYMENT_LIMITS.MAX_AMOUNT) {
      logError('Webhook amount out of bounds', { reference, amount: data.amount });
      await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
      return;
    }
    
    if (data.amount !== transaction.amount) {
      logError('Webhook amount mismatch', {
        reference,
        expectedAmount: transaction.amount,
        actualAmount: data.amount
      });
      await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
      return;
    }
  }
  
  let metadata = {};
  try {
    metadata = typeof transaction.metadata === 'string' 
      ? JSON.parse(transaction.metadata) 
      : (transaction.metadata || {});
  } catch (e) {
    logError('Failed to parse metadata in webhook', { error: e.message, reference });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return;
  }
  
  // Tokenization flow: ₦50 charge used only to capture a reusable card auth code.
  // Activate the subscription, refund immediately, and skip order creation.
  if (metadata.is_tokenization === true) {
    await handleTokenizationSuccess(transaction, data, metadata);
    return;
  }

  const isSubscription = metadata.subscription_id || metadata.is_subscription;
  const isPlateNumber = metadata.payment_type === 'plate_number';
  const isDriverLicense = metadata.payment_type === 'driver_license';
  const orderType = isDriverLicense
    ? ORDER_TYPE.DRIVER_LICENSE
    : isPlateNumber
      ? ORDER_TYPE.PLATE_NUMBER
      : (isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL);
  const paymentScheduleIds = metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];

  const processResult = await processPaymentSuccess({
    reference: transaction.reference,
    status: PAYMENT_STATUS.SUCCESSFUL,
    channel: data.channel,
    authorization_code: data.authorization?.authorization_code,
    paid_at: data.paid_at,
    orderType,
    renewalMonths: metadata.renewal_months || 12,
    selectedItems: paymentScheduleIds,
    renewalAmount: metadata.renewal_amount || transaction.amount,
    deliveryFee: metadata.delivery_fee || 0,
    deliveryAddress: metadata.delivery_details?.address || null,
    deliveryState: metadata.delivery_details?.state || null,
    deliveryLGA: metadata.delivery_details?.lga || null,
    deliveryContact: metadata.delivery_details?.contact || null,
    metadata,
    renewalState: metadata.renewal_state || null
  });
  
  if (processResult.alreadyProcessed) {
    logDebug('[Webhook] Transaction already finalized', { reference });
    return;
  }
  
  let order = null;
  if (processResult.orderId) {
    try {
      order = await getOrderById(processResult.orderId);
    } catch (orderError) {
      logError('Failed to get order by ID', { error: orderError, orderId: processResult.orderId });
      try {
        order = await getOrderByTransactionId(transaction.id);
      } catch (txOrderError) {
        logError('Failed to get order by transaction ID', { error: txOrderError });
      }
    }
  }

  // Link the new order back to the driver_license_application so admin can see it
  if (isDriverLicense && order?.id && transaction?.user_id) {
    try {
      const licenseType = metadata.licenseType || metadata.license_type || 'new';
      await getSupabaseAdmin()
        .from('driver_license_applications')
        .update({ order_id: order.id, updated_at: new Date().toISOString() })
        .eq('user_id', transaction.user_id)
        .eq('application_type', licenseType);
      logInfo('[Webhook] Linked order to driver_license_application', {
        orderId: order.id, userId: transaction.user_id, licenseType
      });
    } catch (linkErr) {
      logError('[Webhook] Failed to link order to driver_license_application (non-fatal)', {
        error: linkErr.message, orderId: order?.id
      });
    }
  }

  const updatedTransaction = await getTransactionByReference(reference);

  if (!processResult.alreadyProcessed) {
    try {
      await PaymentSuccessService.processPaymentSuccessSideEffects({
        transaction: updatedTransaction,
        gatewayData: data,
        order
      });
    } catch (notifyError) {
      logError('Failed to send notifications after payment success', { error: notifyError, reference });
    }
  }
  
  await logPaymentAudit({
    eventType: 'webhook_success',
    transactionId: updatedTransaction.id,
    reference,
    userId: updatedTransaction.user_id,
    paymentGateway: 'paystack',
    amountKobo: updatedTransaction.amount,
    statusBefore: PAYMENT_STATUS.PENDING,
    statusAfter: PAYMENT_STATUS.SUCCESSFUL,
    metadata: { orderId: processResult.orderId },
  });

  logInfo('[Webhook] Charge success processed', {
    reference,
    transactionId: updatedTransaction.id,
    orderId: processResult.orderId
  });
}

async function handleTokenizationSuccess(transaction, data, metadata) {
  const subscriptionId = metadata.subscription_id;
  const authorization = data.authorization;
  const authCode = authorization?.authorization_code;

  if (!authCode) {
    logError('[Tokenization] No authorization_code in webhook data', {
      reference: transaction.reference,
      subscriptionId
    });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return;
  }

  if (!authorization.reusable) {
    logWarn('[Tokenization] Card is not reusable — cannot set up auto-renewal', {
      reference: transaction.reference,
      subscriptionId
    });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return;
  }

  // Activate the subscription with the card details
  await activateSubscription(subscriptionId, authCode, {
    card_type: authorization.card_type,
    last4: authorization.last4,
    exp_month: authorization.exp_month,
    exp_year: authorization.exp_year,
    bank: authorization.bank
  });

  // Mark the ₦50 transaction as successful
  await updateTransactionStatus(transaction.reference, {
    status: PAYMENT_STATUS.SUCCESSFUL,
    authorization_code: authCode,
    paid_at: data.paid_at,
    channel: data.channel
  });

  // Immediately refund the ₦50 — it was only for tokenization
  try {
    await createRefund({
      transaction: data.reference,
      reason: 'Card tokenization fee — auto-refund'
    });
    logInfo('[Tokenization] ₦50 refund issued', { reference: transaction.reference });
  } catch (refundError) {
    // Non-fatal: subscription is activated, refund can be retried manually
    logError('[Tokenization] Refund failed (subscription still activated)', {
      reference: transaction.reference,
      error: refundError.message
    });
  }

  logInfo('[Tokenization] Subscription activated successfully', {
    reference: transaction.reference,
    subscriptionId
  });
}

async function handleChargeFailed(data, eventId) {
  const reference = data.reference;
  
  logDebug('[Webhook] Processing charge.failed', { reference, eventId });
  
  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      logDebug('[Webhook] Duplicate event', { eventId });
      return;
    }
  }
  
  const transaction = await getTransactionByPaystackReference(reference);
  
  if (!transaction) {
    // Check if this is a guest renewal order before giving up
    await markGuestOrderFailed(reference);
    logError('Transaction not found for webhook (charge failed)', { reference });
    return;
  }
  
  await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });

  await logPaymentAudit({
    eventType: 'webhook_failed',
    transactionId: transaction.id,
    reference,
    userId: transaction.user_id,
    paymentGateway: 'paystack',
    amountKobo: transaction.amount,
    statusBefore: transaction.status,
    statusAfter: PAYMENT_STATUS.FAILED,
    metadata: { eventId },
  });
  
  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
    } catch (error) {
      logError('Failed to store webhook event ID', { error, reference, eventId });
    }
  }
  
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, first_name, user_id')
      .eq('id', transaction.user_id)
      .single();
    
    if (profile?.email) {
      const { data: car } = await supabaseAdmin
        .from('cars')
        .select('vehicle_make, vehicle_model, registration_no')
        .eq('id', transaction.car_id)
        .single();
      
      await sendPaymentFailedEmail({
        to: profile.email,
        firstName: profile.first_name,
        amount: transaction.amount,
        reference: transaction.reference,
        carDetails: car
      });
      
      await createInAppNotification(
        transaction.user_id,
        'payment',
        'payment_failed',
        `Payment of ${formatAmount(transaction.amount)} failed. Please try again.`
      );
    }
  } catch (notifyError) {
    logError('Failed to send payment failure notification', notifyError);
  }
  
  logInfo('[Webhook] Charge failed processed', { reference });
}

async function handleMonicreditPaymentSuccess(data) {
  const orderId = data.order_id || data.transid;
  
  if (!orderId) {
    logError('Monicredit webhook missing order_id', { data });
    return;
  }
  
  const eventId = generateMonicreditEventId(orderId, 'payment.success', data.transid);
  
  const existingTransaction = await getTransactionByWebhookEventId(eventId);
  if (existingTransaction) {
    logDebug('[Monicredit Webhook] Duplicate event', { eventId });
    return;
  }
  
  let transaction = await getTransactionByMonicreditOrderId(orderId);
  
  if (!transaction) {
    // orderId for Monicredit is our internal payment reference — check guest orders
    const guestOrder = await markGuestOrderPaid(orderId);
    if (guestOrder) {
      logInfo('[Monicredit Webhook] Guest order marked as paid', { orderId, guestOrderId: guestOrder.id });
      return;
    }
    // Check if this is a Ladipo marketplace order
    try {
      const ladipoOrder = await fulfillLadipoOrder(orderId, null, { gateway: 'monicredit' });
      if (ladipoOrder) {
        logInfo('[Monicredit Webhook] Ladipo order fulfilled via webhook', {
          orderId,
          order_number: ladipoOrder.order_number
        });
        return;
      }
    } catch (ladipoErr) {
      logError('[Monicredit Webhook] Ladipo fulfillment error (non-fatal)', {
        orderId,
        error: ladipoErr.message
      });
    }
    logError('Transaction not found for Monicredit webhook', { orderId });
    return;
  }
  
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Monicredit Webhook] Transaction already processed', { reference: transaction.reference });
    return;
  }

  // If the transaction was abandoned (user re-initiated payment) but the user still
  // paid on the original virtual account, recover it so the RPC can create the order
  if (transaction.status === PAYMENT_STATUS.ABANDONED) {
    logWarn('[Monicredit Webhook] Payment received for abandoned transaction — recovering', { reference: transaction.reference });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.PENDING });
    transaction = await getTransactionByMonicreditOrderId(orderId);
  }

  // Store event ID before processing — prevents race conditions on concurrent webhooks
  try {
    await updateTransactionWebhookEventId(transaction.reference, eventId);
  } catch (error) {
    if (error.code === '23505') {
      logDebug('[Monicredit Webhook] Duplicate event (unique constraint)', { eventId });
      return;
    }
    logError('Failed to store Monicredit webhook event ID', { error, reference: transaction.reference, eventId });
  }
  
  // Re-verify with Monicredit API (defense in depth — webhook signature already
  // verified by middleware).  If the verify call fails or returns non-approved
  // we log a warning and continue: the signature verification is the primary
  // trust anchor.  We only hard-abort on a *confirmed* amount mismatch.
  let verificationResult = null;
  let verifySkipped = false;

  try {
    verificationResult = await MonicreditAdapter.verifyPayment(orderId);

    const responseStatus = verificationResult.raw_response?.status;
    const dataStatus = verificationResult.status?.toLowerCase();

    const isApproved = (
      (responseStatus === true || responseStatus === 'success') &&
      (dataStatus === 'approved' || dataStatus === 'success')
    );

    if (!isApproved) {
      logWarn('[Monicredit Webhook] Verify returned non-approved — continuing on webhook signature', {
        orderId, responseStatus, dataStatus
      });
      verifySkipped = true;
    }
  } catch (error) {
    logWarn('[Monicredit Webhook] Verify API call failed — continuing on webhook signature', {
      orderId, error: error.message
    });
    verifySkipped = true;
  }

  // Only check amount when we have a confirmed verification result
  const monicreditAmount = verificationResult?.amount || 0;
  if (!verifySkipped && monicreditAmount > 0) {
    try {
      validatePaymentAmount(transaction.amount, monicreditAmount, 1);
    } catch (error) {
      if (error instanceof AmountValidationError) {
        logError('Monicredit webhook amount mismatch — aborting', {
          orderId,
          expected_kobo: transaction.amount,
          actual_kobo: monicreditAmount,
          difference_kobo: error.difference
        });
        return;
      }
      throw error;
    }
  }
  
  let metadata = {};
  try {
    metadata = typeof transaction.metadata === 'string' 
      ? JSON.parse(transaction.metadata) 
      : (transaction.metadata || {});
  } catch (e) {
    logError('Failed to parse metadata in Monicredit webhook', { error: e.message, orderId });
    return;
  }
  
  const isSubscription = metadata.subscription_id || metadata.is_subscription;
  const isPlateNumber = metadata.payment_type === 'plate_number';
  const isDriverLicense = metadata.payment_type === 'driver_license';
  const orderType = isDriverLicense
    ? ORDER_TYPE.DRIVER_LICENSE
    : isPlateNumber
      ? ORDER_TYPE.PLATE_NUMBER
      : (isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL);
  const paymentScheduleIds = metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];
  
  await updateTransactionStatus(transaction.reference, {
    status: PAYMENT_STATUS.SUCCESSFUL,
    channel: verificationResult?.channel || data.channel || 'bank_transfer',
    authorization_code: null,
    paid_at: verificationResult?.date_paid || data.paid_at || new Date().toISOString()
  });
  
  const processResult = await processPaymentSuccess({
    reference: transaction.reference,
    status: PAYMENT_STATUS.SUCCESSFUL,
    channel: verificationResult?.channel || data.channel || 'bank_transfer',
    authorization_code: null,
    paid_at: verificationResult?.date_paid || data.paid_at || new Date().toISOString(),
    orderType,
    renewalMonths: metadata.renewal_months || 12,
    selectedItems: paymentScheduleIds,
    renewalAmount: metadata.renewal_amount || transaction.amount,
    deliveryFee: metadata.delivery_fee || 0,
    deliveryAddress: metadata.delivery_details?.address || metadata.delivery_address,
    deliveryState: metadata.delivery_details?.state || metadata.delivery_state,
    deliveryLGA: metadata.delivery_details?.lga || metadata.delivery_lga,
    deliveryContact: metadata.delivery_details?.contact || metadata.delivery_contact,
    metadata,
    renewalState: metadata.renewal_state || null
  });
  
  const updatedTransaction = await getTransactionByReference(transaction.reference);
  const createdOrder = processResult.orderId ? await getOrderById(processResult.orderId).catch(() => null) : null;

  // Link the new order back to the driver_license_application so admin can see it
  if (isDriverLicense && createdOrder?.id && transaction?.user_id) {
    try {
      const licenseType = metadata.licenseType || metadata.license_type || 'new';
      await getSupabaseAdmin()
        .from('driver_license_applications')
        .update({ order_id: createdOrder.id, updated_at: new Date().toISOString() })
        .eq('user_id', transaction.user_id)
        .eq('application_type', licenseType);
      logInfo('[Monicredit Webhook] Linked order to driver_license_application', {
        orderId: createdOrder.id, userId: transaction.user_id, licenseType
      });
    } catch (linkErr) {
      logError('[Monicredit Webhook] Failed to link order to driver_license_application (non-fatal)', {
        error: linkErr.message, orderId: createdOrder?.id
      });
    }
  }

  if (!processResult.alreadyProcessed) {
    try {
      await PaymentSuccessService.processPaymentSuccessSideEffects({
        transaction: updatedTransaction,
        gatewayData: verificationResult || data,
        order: createdOrder
      });

      logInfo('[Monicredit Webhook] Side-effects processed', { reference: transaction.reference });
    } catch (notifyError) {
      // Payment is already committed — log but don't rethrow
      logError('Failed to send notifications after Monicredit payment success', {
        error: notifyError.message,
        reference: transaction.reference
      });
    }
  }
  
  await logPaymentAudit({
    eventType: 'webhook_success',
    transactionId: updatedTransaction.id,
    reference: transaction.reference,
    userId: updatedTransaction.user_id,
    paymentGateway: 'monicredit',
    amountKobo: updatedTransaction.amount,
    statusBefore: PAYMENT_STATUS.PENDING,
    statusAfter: PAYMENT_STATUS.SUCCESSFUL,
    metadata: { orderId, monicreditOrderId: orderId },
  });

  logInfo('[Monicredit Webhook] Payment success processed', {
    orderId,
    transactionId: updatedTransaction.id,
    orderDbId: processResult.orderId
  });
}

async function handleMonicreditPaymentFailed(data) {
  const orderId = data.order_id || data.transid;
  
  if (!orderId) {
    logError('Monicredit webhook missing order_id', { data });
    return;
  }
  
  const eventId = generateMonicreditEventId(orderId, 'payment.failed', data.transid);
  
  const existingTransaction = await getTransactionByWebhookEventId(eventId);
  if (existingTransaction) {
    logDebug('[Monicredit Webhook] Duplicate event', { eventId });
    return;
  }
  
  const transaction = await getTransactionByMonicreditOrderId(orderId);
  
  if (!transaction) {
    // Check Ladipo orders before giving up
    const ladipoOrder = await markLadipoOrderPaymentFailed(orderId, { gateway: 'monicredit' });
    if (ladipoOrder) {
      logInfo('[Monicredit Webhook] Ladipo order marked failed via webhook', {
        orderId,
        order_number: ladipoOrder.order_number
      });
      return;
    }
    await markGuestOrderFailed(orderId);
    logError('Transaction not found for Monicredit webhook (failed)', { orderId });
    return;
  }
  
  await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });

  await logPaymentAudit({
    eventType: 'webhook_failed',
    transactionId: transaction.id,
    reference: transaction.reference,
    userId: transaction.user_id,
    paymentGateway: 'monicredit',
    amountKobo: transaction.amount,
    statusBefore: transaction.status,
    statusAfter: PAYMENT_STATUS.FAILED,
    metadata: { orderId, eventId },
  });
  
  try {
    await updateTransactionWebhookEventId(transaction.reference, eventId);
  } catch (error) {
    logError('Failed to store Monicredit webhook event ID', { error, reference: transaction.reference, eventId });
  }
  
  logInfo('[Monicredit Webhook] Payment failure processed', { orderId });
}
