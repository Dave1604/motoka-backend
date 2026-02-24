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
import {
  parseWebhookEvent
} from '../../services/payment/paystack.service.js';
import {
  generateMonicreditEventId
} from '../../services/payment/monicredit/monicredit.service.js';
import { MonicreditAdapter } from '../../services/payment/monicredit/index.js';

/**
 * Webhook Controller
 * 
 * Handles webhook events from payment gateways (Paystack and Monicredit).
 */

/**
 * Handle Paystack webhook
 * POST /api/webhooks/paystack
 */
export const handlePaystackWebhook = async (req, res) => {
  try {
    // Signature is verified in middleware
    const { event, data, eventId } = parseWebhookEvent(req.body);
    
    logDebug('[Paystack Webhook] Received event', {
      event,
      eventId,
      reference: data?.reference
    });
    
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
    // Return 200 to prevent Paystack from retrying
    const isProduction = process.env.NODE_ENV === 'production';
    return res.status(200).json({
      received: true,
      ...(isProduction ? {} : { error: error.message })
    });
  }
};

/**
 * Handle Monicredit webhook
 * POST /api/webhooks/monicredit
 */
export const handleMonicreditWebhook = async (req, res) => {
  const webhookStartTime = Date.now();
  let signatureVerified = false;
  
  try {
    logDebug('[Monicredit Webhook] Received webhook', {
      order_id: req.body?.order_id || req.body?.data?.order_id,
      event: req.body?.event || req.body?.type,
      status: req.body?.status
    });
    
    const webhookData = req.body;
    
    // Normalise both event-keyed and status-keyed payload shapes
    const event = webhookData.event || webhookData.type;
    const data = webhookData.data || webhookData;
    
    signatureVerified = true; // Assume verified if we reach here
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
        order_id: data?.order_id || webhookData?.order_id,
        webhookData: { status: webhookData?.status, type: webhookData?.type }
      });
      paymentMetrics.trackWebhookFailure();
    }
    
    return res.status(200).json({ received: true });
    
  } catch (error) {
    const webhookProcessingTime = Date.now() - webhookStartTime;
    
    logError('Monicredit webhook processing error', error);
    
    paymentMetrics.trackWebhook({
      signatureVerified,
      isDuplicate: false,
      processingTime: webhookProcessingTime
    });
    paymentMetrics.trackWebhookFailure();
    
    // Return 200 even on errors to prevent Monicredit from retrying
    const isProduction = process.env.NODE_ENV === 'production';
    return res.status(200).json({
      received: true,
      ...(isProduction ? {} : { error: error.message })
    });
  }
};

/**
 * Handle Paystack charge.success event
 * @private
 */
async function handleChargeSuccess(data, eventId) {
  const reference = data.reference;
  
  logDebug('[Webhook] Processing charge.success', { reference, eventId });
  
  // Check for duplicate event ID
  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      logDebug('[Webhook] Duplicate event ID detected, already processed', { eventId });
      return;
    }
  }
  
  // Get transaction
  let transaction = await getTransactionByPaystackReference(reference);
  if (!transaction) {
    transaction = await getTransactionByReference(reference);
  }
  
  if (!transaction) {
    logError('Transaction not found for webhook', { reference });
    return;
  }
  
  // Idempotency check
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Webhook] Transaction already processed', { reference });
    return;
  }
  
  // Store event ID BEFORE processing (atomic idempotency lock)
  // This prevents race conditions where two concurrent webhooks both pass the duplicate check
  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
      logDebug('[Webhook] Event ID stored for replay protection', { eventId });
    } catch (error) {
      // Handle unique constraint violation (23505) as duplicate detection
      if (error.code === '23505') {
        logDebug('[Webhook] Duplicate event ID detected via unique constraint', { eventId });
        return;
      }
      // For other errors, log but continue processing (event ID storage is best-effort)
      logError('Failed to store webhook event ID', { error, reference, eventId });
    }
  }
  
  // Validate amount
  if (typeof data.amount === 'number') {
    if (data.amount < PAYMENT_LIMITS.MIN_AMOUNT || data.amount > PAYMENT_LIMITS.MAX_AMOUNT) {
      logError('Webhook amount out of bounds', { reference, amount: data.amount });
      await updateTransactionStatus(transaction.reference, {
        status: PAYMENT_STATUS.FAILED
      });
      return;
    }
    
    if (data.amount !== transaction.amount) {
      logError('Webhook amount mismatch', {
        reference,
        expectedAmount: transaction.amount,
        actualAmount: data.amount
      });
      await updateTransactionStatus(transaction.reference, {
        status: PAYMENT_STATUS.FAILED
      });
      return;
    }
  }
  
  // Parse metadata
  let metadata = {};
  try {
    metadata = typeof transaction.metadata === 'string' 
      ? JSON.parse(transaction.metadata) 
      : (transaction.metadata || {});
  } catch (e) {
    logError('Failed to parse metadata in webhook', {
      error: e.message,
      reference
    });
    await updateTransactionStatus(transaction.reference, {
      status: PAYMENT_STATUS.FAILED
    });
    return;
  }
  
  const isSubscription = metadata.subscription_id || metadata.is_subscription;
  const orderType = isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL;
  const paymentScheduleIds = metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];
  
  // Process payment success
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
  
  // Get order
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
  
  // Get updated transaction
  const updatedTransaction = await getTransactionByReference(reference);
  
  // Process side-effects
  if (!processResult.alreadyProcessed) {
    try {
      await PaymentSuccessService.processPaymentSuccessSideEffects({
        transaction: updatedTransaction,
        gatewayData: data,
        order
      });
    } catch (notifyError) {
      logError('Failed to send notifications after payment success', {
        error: notifyError,
        reference
      });
    }
  }
  
  logInfo('[Webhook] Charge success processed', {
    reference,
    transactionId: updatedTransaction.id,
    orderId: processResult.orderId
  });
}

/**
 * Handle Paystack charge.failed event
 * @private
 */
async function handleChargeFailed(data, eventId) {
  const reference = data.reference;
  
  logDebug('[Webhook] Processing charge.failed', { reference, eventId });
  
  // Check for duplicate event ID
  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      logDebug('[Webhook] Duplicate event ID detected', { eventId });
      return;
    }
  }
  
  const transaction = await getTransactionByPaystackReference(reference);
  
  if (!transaction) {
    logError('Transaction not found for webhook', { reference });
    return;
  }
  
  // Update transaction status
  await updateTransactionStatus(transaction.reference, {
    status: PAYMENT_STATUS.FAILED
  });
  
  // Store event ID
  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
      logDebug('[Webhook] Event ID stored', { eventId });
    } catch (error) {
      logError('Failed to store webhook event ID', { error, reference, eventId });
    }
  }
  
  // Send failure notification
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

/**
 * Handle Monicredit payment.success event
 * @private
 */
async function handleMonicreditPaymentSuccess(data) {
  const orderId = data.order_id || data.transid;
  
  logDebug('[Monicredit Webhook] Processing payment success', {
    orderId,
    transid: data.transid,
    status: data.status
  });
  
  if (!orderId) {
    logError('Monicredit webhook missing order_id', { data });
    return;
  }
  
  // Generate event ID
  const eventId = generateMonicreditEventId(orderId, 'payment.success', data.transid);
  
  // Check for duplicate event ID
  const existingTransaction = await getTransactionByWebhookEventId(eventId);
  if (existingTransaction) {
    logDebug('[Monicredit Webhook] Duplicate event ID detected', { eventId });
    return;
  }
  
  let transaction = await getTransactionByMonicreditOrderId(orderId);
  
  if (!transaction) {
    logError('Transaction not found for Monicredit webhook', { orderId });
    return;
  }
  
  // Idempotency check
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Monicredit Webhook] Transaction already processed', { reference: transaction.reference });
    return;
  }
  
  // Store event ID BEFORE processing (atomic idempotency lock)
  // This prevents race conditions where two concurrent webhooks both pass the duplicate check
  try {
    await updateTransactionWebhookEventId(transaction.reference, eventId);
    logDebug('[Monicredit Webhook] Event ID stored for replay protection', { eventId });
  } catch (error) {
    // Handle unique constraint violation (23505) as duplicate detection
    if (error.code === '23505') {
      logDebug('[Monicredit Webhook] Duplicate event ID detected via unique constraint', { eventId });
      return;
    }
    // For other errors, log but continue processing (event ID storage is best-effort)
    logError('Failed to store Monicredit webhook event ID', { error, reference: transaction.reference, eventId });
  }
  
  // Re-verify with Monicredit API
  let verificationResult;
  try {
    verificationResult = await MonicreditAdapter.verifyPayment(orderId);
  } catch (error) {
    logError('Monicredit webhook verification failed', {
      orderId,
      error: error.message
    });
    return;
  }
  
  const responseStatus = verificationResult.raw_response?.status;
  const dataStatus = verificationResult.status?.toLowerCase();
  
  const isApproved = (
    (responseStatus === true || responseStatus === 'success') &&
    (dataStatus === 'approved' || dataStatus === 'success')
  );
  
  if (!isApproved) {
    logError('[Monicredit Webhook] Payment not approved - aborting processing', {
      orderId,
      responseStatus,
      dataStatus,
      verificationResult: {
        status: verificationResult.status,
        raw_status: verificationResult.raw_response?.status,
        success: verificationResult.success
      }
    });
    return; // CRITICAL: Must return early to prevent processing unapproved payments
  }
  
  // Validate amount
  const monicreditAmount = verificationResult.amount || 0;
  const expectedAmount = transaction.amount;
  
  try {
    validatePaymentAmount(expectedAmount, monicreditAmount, 1);
  } catch (error) {
    if (error instanceof AmountValidationError) {
      logError('Monicredit webhook amount mismatch', {
        orderId,
        expectedAmount_kobo: expectedAmount,
        actualAmount_kobo: monicreditAmount,
        difference_kobo: error.difference
      });
      return;
    }
    throw error;
  }
  
  // Parse metadata
  let metadata = {};
  try {
    metadata = typeof transaction.metadata === 'string' 
      ? JSON.parse(transaction.metadata) 
      : (transaction.metadata || {});
  } catch (e) {
    logError('Failed to parse metadata in Monicredit webhook', {
      error: e.message,
      orderId
    });
    return;
  }
  
  const isSubscription = metadata.subscription_id || metadata.is_subscription;
  const orderType = isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL;
  const paymentScheduleIds = metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];
  
  // Update transaction status
  await updateTransactionStatus(transaction.reference, {
    status: PAYMENT_STATUS.SUCCESSFUL,
    channel: verificationResult.channel || 'bank_transfer',
    authorization_code: null,
    paid_at: verificationResult.date_paid || new Date().toISOString()
  });
  
  // Process payment success
  const processResult = await processPaymentSuccess({
    reference: transaction.reference,
    status: PAYMENT_STATUS.SUCCESSFUL,
    channel: verificationResult.channel || 'bank_transfer',
    authorization_code: null,
    paid_at: verificationResult.date_paid || new Date().toISOString(),
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
  
  // Process side-effects (send email, notifications)
  if (!processResult.alreadyProcessed) {
    try {
      logInfo('[Monicredit Webhook] Processing side-effects (email, notifications)', {
        reference: transaction.reference,
        orderId: processResult.orderId,
        hasOrder: !!createdOrder
      });
      
      await PaymentSuccessService.processPaymentSuccessSideEffects({
        transaction: updatedTransaction,
        gatewayData: verificationResult,
        order: createdOrder
      });
      
      logInfo('[Monicredit Webhook] Side-effects processed successfully', {
        reference: transaction.reference
      });
    } catch (notifyError) {
      logError('Failed to send notifications after Monicredit payment success', {
        error: notifyError,
        errorMessage: notifyError.message,
        errorStack: notifyError.stack,
        reference: transaction.reference,
        userId: transaction.user_id
      });
      // Don't throw - payment is already processed, but log for debugging
    }
  } else {
    logInfo('[Monicredit Webhook] Payment already processed, skipping side-effects', {
      reference: transaction.reference
    });
  }
  
  logInfo('[Monicredit Webhook] Payment success processed', {
    orderId,
    transactionId: updatedTransaction.id,
    orderId: processResult.orderId
  });
}

/**
 * Handle Monicredit payment.failed event
 * @private
 */
async function handleMonicreditPaymentFailed(data) {
  const orderId = data.order_id || data.transid;
  
  logDebug('[Monicredit Webhook] Processing payment failure', {
    orderId,
    transid: data.transid,
    status: data.status
  });
  
  if (!orderId) {
    logError('Monicredit webhook missing order_id', { data });
    return;
  }
  
  // Generate event ID
  const eventId = generateMonicreditEventId(orderId, 'payment.failed', data.transid);
  
  // Check for duplicate event ID
  const existingTransaction = await getTransactionByWebhookEventId(eventId);
  if (existingTransaction) {
    logDebug('[Monicredit Webhook] Duplicate event ID detected', { eventId });
    return;
  }
  
  const transaction = await getTransactionByMonicreditOrderId(orderId);
  
  if (!transaction) {
    logError('Transaction not found for Monicredit webhook', { orderId });
    return;
  }
  
  // Update transaction status
  await updateTransactionStatus(transaction.reference, {
    status: PAYMENT_STATUS.FAILED
  });
  
  // Store event ID
  try {
    await updateTransactionWebhookEventId(transaction.reference, eventId);
    logDebug('[Monicredit Webhook] Event ID stored', { eventId });
  } catch (error) {
    logError('Failed to store Monicredit webhook event ID', { error, reference: transaction.reference, eventId });
  }
  
  logInfo('[Monicredit Webhook] Payment failure processed', { orderId });
}
