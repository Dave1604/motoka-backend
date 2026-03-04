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
import { parseWebhookEvent, verifyTransaction as paystackVerifyTransaction } from '../../services/payment/paystack.service.js';
import { generateMonicreditEventId } from '../../services/payment/monicredit/monicredit.service.js';
import { MonicreditAdapter } from '../../services/payment/monicredit/index.js';
import { logPaymentAudit } from '../../services/payment/audit.service.js';

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
    const webhookData = req.body;
    
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
    logError('Transaction not found for webhook', { reference });
    return;
  }
  
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Webhook] Transaction already processed', { reference });
    return;
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
    metadata
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
    logError('Transaction not found for webhook', { reference });
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
    logError('Transaction not found for Monicredit webhook', { orderId });
    return;
  }
  
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Monicredit Webhook] Transaction already processed', { reference: transaction.reference });
    return;
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
    metadata
  });
  
  const updatedTransaction = await getTransactionByReference(transaction.reference);
  const createdOrder = processResult.orderId ? await getOrderById(processResult.orderId).catch(() => null) : null;
  
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
    logError('Transaction not found for Monicredit webhook', { orderId });
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
