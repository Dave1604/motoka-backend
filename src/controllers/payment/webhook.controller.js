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
  MONIPAY_EVENTS,
  PAYMENT_LIMITS,
  ERROR_MESSAGES
} from '../../constants/payment.constants.js';
import { PaymentSuccessService } from '../../services/payment/payment-success.service.js';
import { handleWalletFundingSuccess } from '../../services/wallet/wallet.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { sendPaymentFailedEmail } from '../../services/email/paymentEmail.service.js';
import { createInAppNotification } from '../../services/notification.service.js';
import { formatAmount } from '../../utils/paymentHelpers.js';
import { parseWebhookEvent, verifyTransaction as paystackVerifyTransaction, createRefund } from '../../services/payment/paystack.service.js';
import {
  parseWebhookEvent as parseMonipayWebhookEvent,
  verifyTransaction as monipayVerifyTransaction,
  isPaidStatus,
} from '../../services/payment/monipay/monipay.service.js';
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
    return res.status(500).json({ received: false });
  }
};

// POST /api/webhooks/monipay
export const handleMonipayWebhook = async (req, res) => {
  try {
    const { event, data, eventId } = parseMonipayWebhookEvent(req.body);
    const evt = String(event || '').toLowerCase();
    const paidHint = evt === MONIPAY_EVENTS.CHARGE_SUCCESS
      || evt === 'payment.success'
      || isPaidStatus(data?.status || req.body?.status);

    logDebug('[Monipay Webhook] Received event', {
      event,
      eventId,
      reference: data?.reference || data?.order_id,
    });

    if (paidHint) {
      await handleMonipayChargeSuccess(data, eventId);
    } else if (evt === MONIPAY_EVENTS.CHARGE_FAILED || evt === 'payment.failed') {
      await handleMonipayChargeFailed(data, eventId);
    } else {
      logInfo('[Monipay Webhook] Unhandled event', { event });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logError('Monipay webhook processing error', error);
    return res.status(500).json({ received: false });
  }
};

async function handleMonipayChargeSuccess(data, eventId) {
  const reference = data?.reference || data?.order_id || data?.trans_id;
  if (!reference) {
    logError('[Monipay Webhook] Missing reference', { data });
    return;
  }

  logDebug('[Monipay Webhook] Processing charge.success', { reference, eventId });

  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      logDebug('[Monipay Webhook] Duplicate event, already processed', { eventId });
      return;
    }
  }

  let transaction = await getTransactionByReference(reference);
  if (!transaction) {
    // Guest orders have no payment_transactions row, so none of the checks below
    // run for them. They used to be fulfilled straight off the webhook body,
    // which made the signature the only thing between a forged POST and free
    // vehicle papers. Re-verify against the API first, exactly as the signed-in
    // path does. (Ladipo needs no equivalent here — verifyAndFulfillOrder calls
    // the gateway and amount-checks on its own.)
    const guestOrder = await markGuestOrderPaid(reference, {
      verifyWithGateway: async () => monipayVerifyTransaction(reference),
    });
    if (guestOrder) {
      logInfo('[Monipay Webhook] Guest order marked as paid', { reference, orderId: guestOrder.id });
      return;
    }

    try {
      const ladipoOrder = await fulfillLadipoOrder(reference, null, {
        gateway: PAYMENT_GATEWAY.MONIPAY,
      });
      if (ladipoOrder) {
        logInfo('[Monipay Webhook] Ladipo order fulfilled via webhook', {
          reference,
          order_number: ladipoOrder.order_number,
        });
        return;
      }
    } catch (ladipoErr) {
      logError('[Monipay Webhook] Ladipo fulfillment error', { reference, error: ladipoErr.message });
      throw ladipoErr;
    }

    logError('[Monipay Webhook] Transaction not found', { reference });
    return;
  }

  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    logDebug('[Monipay Webhook] Transaction already processed', { reference });
    return;
  }

  if (transaction.status === PAYMENT_STATUS.ABANDONED) {
    logWarn('[Monipay Webhook] Payment received for abandoned transaction — recovering', { reference });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.PENDING });
    transaction = await getTransactionByReference(reference);
  }

  let verifyResult;
  try {
    verifyResult = await monipayVerifyTransaction(transaction.reference || reference);
  } catch (verifyErr) {
    logError('[Monipay Webhook] Verify failed', { reference, error: verifyErr.message });
    throw verifyErr;
  }

  if (!verifyResult.success && verifyResult.status !== 'success') {
    logError('[Monipay Webhook] Verify returned non-success', { reference, status: verifyResult.status });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return;
  }

  // Monipay's docs say to fulfil only when the status indicates success AND the
  // amount matches, so a missing amount is not a reason to skip the check — it is
  // a reason not to fulfil. Leave the transaction pending rather than marking it
  // failed: the money may well have been taken, and the poller or a human needs
  // to be able to pick it up.
  if (typeof verifyResult.amount !== 'number') {
    logError('[Monipay Webhook] Verify returned no usable amount — not fulfilling', {
      reference,
      expected: transaction.amount,
      reported: verifyResult.amount,
    });
    return;
  }

  if (Math.abs(verifyResult.amount - transaction.amount) > 1) {
    logError('[Monipay Webhook] Verify amount mismatch', {
      reference,
      expected: transaction.amount,
      actual: verifyResult.amount,
    });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return;
  }

  let metadata = {};
  try {
    metadata = typeof transaction.metadata === 'string'
      ? JSON.parse(transaction.metadata)
      : (transaction.metadata || {});
  } catch (e) {
    logError('[Monipay Webhook] Failed to parse metadata', { error: e.message, reference });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return;
  }

  if (metadata.payment_type === PAYMENT_TYPE.WALLET_FUNDING) {
    await handleWalletFundingSuccess(transaction, { ...data, ...verifyResult }, metadata);
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
    channel: verifyResult.channel || data.channel,
    authorization_code: verifyResult.authorization?.authorization_code || null,
    paid_at: verifyResult.paid_at || data.paid_at,
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
    renewalState: metadata.renewal_state || null,
  });

  if (eventId) {
    try {
      await updateTransactionWebhookEventId(transaction.reference, eventId);
    } catch (error) {
      logError('[Monipay Webhook] Failed to store event ID after fulfilment', { error, reference, eventId });
    }
  }

  if (processResult.alreadyProcessed) {
    logDebug('[Monipay Webhook] Transaction already finalized', { reference });
    return;
  }

  let order = null;
  if (processResult.orderId) {
    try {
      order = await getOrderById(processResult.orderId);
    } catch (orderError) {
      logError('[Monipay Webhook] Failed to get order by ID', { error: orderError, orderId: processResult.orderId });
      try {
        order = await getOrderByTransactionId(transaction.id);
      } catch (txOrderError) {
        logError('[Monipay Webhook] Failed to get order by transaction ID', { error: txOrderError });
      }
    }
  }

  if (isDriverLicense && order?.id && transaction?.user_id) {
    try {
      const licenseType = metadata.licenseType || metadata.license_type || 'new';
      await getSupabaseAdmin()
        .from('driver_license_applications')
        .update({ order_id: order.id, updated_at: new Date().toISOString() })
        .eq('user_id', transaction.user_id)
        .eq('application_type', licenseType);
    } catch (linkErr) {
      logError('[Monipay Webhook] Failed to link driver_license_application (non-fatal)', {
        error: linkErr.message,
        orderId: order?.id,
      });
    }
  }

  const updatedTransaction = await getTransactionByReference(transaction.reference);

  try {
    await PaymentSuccessService.processPaymentSuccessSideEffects({
      transaction: updatedTransaction,
      gatewayData: verifyResult || data,
      order,
    });
  } catch (notifyError) {
    logError('[Monipay Webhook] Failed to send notifications after payment success', { error: notifyError, reference });
  }

  await logPaymentAudit({
    eventType: 'webhook_success',
    transactionId: updatedTransaction.id,
    reference: transaction.reference,
    userId: updatedTransaction.user_id,
    paymentGateway: PAYMENT_GATEWAY.MONIPAY,
    amountKobo: updatedTransaction.amount,
    statusBefore: PAYMENT_STATUS.PENDING,
    statusAfter: PAYMENT_STATUS.SUCCESSFUL,
    metadata: { orderId: processResult.orderId, monipay_reference: verifyResult.reference || reference },
  });

  logInfo('[Monipay Webhook] Charge success processed', {
    reference: transaction.reference,
    monipay_reference: verifyResult.reference || reference,
    transactionId: updatedTransaction.id,
    orderId: processResult.orderId,
  });
}

async function handleMonipayChargeFailed(data, eventId) {
  const reference = data?.reference || data?.order_id;
  if (!reference) return;

  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) return;
  }

  const transaction = await getTransactionByReference(reference);
  if (!transaction) {
    await markGuestOrderFailed(reference);
    return;
  }

  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) return;

  await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });

  if (eventId) {
    try {
      await updateTransactionWebhookEventId(transaction.reference, eventId);
    } catch (error) {
      logError('[Monipay Webhook] Failed to store failed-event ID', { error, reference, eventId });
    }
  }
}

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
    
    return res.status(500).json({ received: false });
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

  // Wallet funding: credit the ledger instead of creating a renewal order. This
  // deliberately does NOT touch process_payment_success.
  if (metadata.payment_type === PAYMENT_TYPE.WALLET_FUNDING) {
    await handleWalletFundingSuccess(transaction, data, metadata);
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

  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
    } catch (error) {
      logError('Failed to store webhook event ID after fulfilment', { error, reference, eventId });
    }
  }
  
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

  // Re-verify with Monicredit API (defense in depth — webhook signature already
  // verified by middleware). The signature proves the webhook came from
  // Monicredit; the verify call proves the underlying payment actually settled.
  // We refuse to credit on transport error or non-approved state — those are
  // the cases where a forged-but-signed webhook would slip through, or where
  // a webhook race could fire ahead of settlement.
  let verificationResult;
  try {
    verificationResult = await MonicreditAdapter.verifyPayment(orderId);
  } catch (error) {
    // Transport / config error. Don't credit. The poller (or Monicredit's own
    // webhook retry) will bring this through on a subsequent attempt.
    logError('[Monicredit Webhook] Verify API call failed — refusing to credit', {
      orderId, error: error.message
    });
    return;
  }

  if (verificationResult.state !== 'approved') {
    logError('[Monicredit Webhook] Verify returned non-approved state — refusing to credit', {
      orderId,
      state: verificationResult.state,
      inner_status: verificationResult.status
    });
    return;
  }

  // Amount tolerance is configurable in basis points (1 bps = 0.01%).
  // Monicredit may return the amount net of their processing fee; until that
  // is confirmed with their team, the default 200 bps (2%) absorbs typical
  // PSP fees. Set MONICREDIT_AMOUNT_TOLERANCE_BPS=0 to require exact match.
  const monicreditAmount = verificationResult.amount || 0;
  if (monicreditAmount > 0) {
    const toleranceBps = parseInt(process.env.MONICREDIT_AMOUNT_TOLERANCE_BPS || '200', 10);
    const toleranceKobo = Math.max(1, Math.round((transaction.amount * toleranceBps) / 10000));
    try {
      validatePaymentAmount(transaction.amount, monicreditAmount, toleranceKobo);
    } catch (error) {
      if (error instanceof AmountValidationError) {
        logError('[Monicredit Webhook] Amount mismatch beyond tolerance — refusing to credit', {
          orderId,
          expected_kobo: transaction.amount,
          actual_kobo: monicreditAmount,
          difference_kobo: error.difference,
          tolerance_kobo: toleranceKobo,
          tolerance_bps: toleranceBps
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

  try {
    await updateTransactionWebhookEventId(transaction.reference, eventId);
  } catch (error) {
    logError('Failed to store Monicredit webhook event ID after fulfilment', {
      error,
      reference: transaction.reference,
      eventId,
    });
  }
  
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
