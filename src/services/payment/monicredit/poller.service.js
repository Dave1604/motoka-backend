import { getSupabaseAdmin } from '../../../config/supabase.js';
import { logInfo, logWarn, logError, logDebug } from '../../../utils/logger.js';
import {
  PAYMENT_STATUS,
  PAYMENT_GATEWAY,
  PAYMENT_TYPE,
  ORDER_TYPE
} from '../../../constants/payment.constants.js';
import {
  processPaymentSuccess,
  updateTransactionStatus,
  getTransactionByReference
} from '../transaction.service.js';
import {
  getOrderById,
  findRecentActiveOrder
} from '../order.service.js';
import { validatePaymentAmount, AmountValidationError } from '../validation/amount.validator.js';
import { PaymentSuccessService } from '../payment-success.service.js';
import { logPaymentAudit } from '../audit.service.js';
import { MonicreditAdapter } from './index.js';

/**
 * Monicredit Pending Transaction Poller
 *
 * Exists because Monicredit's webhook flow has never delivered to this account.
 * Every successful Monicredit payment to date was admin-fulfilled manually.
 * This service is the automated equivalent: it polls Monicredit's
 * verify-transaction endpoint for any txn we initialised but haven't heard
 * back on, and routes the approved ones through the same fulfilment path
 * the webhook would.
 *
 * Once Monicredit confirms and enables their webhook, the webhook becomes
 * the fast path and this poller becomes the safety net — both writing
 * through the same `processPaymentSuccess` RPC, which is idempotent.
 *
 * Design notes:
 *   - Polls only `pending` Monicredit transactions younger than `maxAgeHours`.
 *     Stale rows beyond that are swept to `abandoned` so the poll set stays small.
 *   - Verification result is structured (`state: approved|pending|failed|unknown`)
 *     so we never accidentally credit a payment Monicredit hasn't approved.
 *   - Amount tolerance is configurable via MONICREDIT_AMOUNT_TOLERANCE_BPS,
 *     same envelope the webhook handler uses.
 *   - Disabled by default in production; opt in by setting
 *     MONICREDIT_POLLER_ENABLED=true.
 */
class MonicreditPoller {
  constructor() {
    this.intervalMs = parseInt(process.env.MONICREDIT_POLLER_INTERVAL_MS || '60000', 10);
    this.maxAgeHours = parseInt(process.env.MONICREDIT_POLLER_MAX_AGE_HOURS || '24', 10);
    this.batchSize = parseInt(process.env.MONICREDIT_POLLER_BATCH_SIZE || '20', 10);
    this.tickInterval = null;
    this.isRunning = false;
    this.isTicking = false;
    this.lastTickAt = null;
    this.stats = { ticks: 0, approved: 0, failed: 0, swept: 0, errors: 0 };
  }

  start() {
    if (this.isRunning) {
      logWarn('[Monicredit Poller] Already running');
      return;
    }

    const enabled = process.env.MONICREDIT_POLLER_ENABLED !== 'false';
    if (!enabled) {
      logInfo('[Monicredit Poller] Disabled via MONICREDIT_POLLER_ENABLED=false');
      return;
    }

    logInfo('[Monicredit Poller] Starting', {
      intervalMs: this.intervalMs,
      maxAgeHours: this.maxAgeHours,
      batchSize: this.batchSize
    });

    this.isRunning = true;
    // Run once immediately so we don't wait the full interval at startup
    this.tick().catch(err => logError('[Monicredit Poller] Initial tick failed', { error: err.message }));
    this.tickInterval = setInterval(() => {
      this.tick().catch(err => logError('[Monicredit Poller] Tick failed', { error: err.message }));
    }, this.intervalMs);
  }

  stop() {
    if (!this.isRunning) return;
    logInfo('[Monicredit Poller] Stopping');
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.isRunning = false;
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      lastTickAt: this.lastTickAt
    };
  }

  async tick() {
    // Guard against tick overlap if a previous tick takes longer than the interval.
    if (this.isTicking) {
      logDebug('[Monicredit Poller] Skipping tick — previous tick still running');
      return;
    }
    this.isTicking = true;
    this.stats.ticks++;
    this.lastTickAt = new Date().toISOString();

    try {
      const supabaseAdmin = getSupabaseAdmin();
      const cutoff = new Date(Date.now() - this.maxAgeHours * 3600 * 1000).toISOString();

      // Sweep stale pendings — keeps the poll set bounded and frees virtual accounts
      const { data: swept } = await supabaseAdmin
        .from('payment_transactions')
        .update({
          status: PAYMENT_STATUS.ABANDONED,
          cancellation_reason: 'user_abandoned', // 24h+ old pending — customer never paid
          updated_at: new Date().toISOString()
        })
        .eq('payment_gateway', PAYMENT_GATEWAY.MONICREDIT)
        .eq('status', PAYMENT_STATUS.PENDING)
        .lt('created_at', cutoff)
        .select('id, reference');
      if (swept?.length) {
        this.stats.swept += swept.length;
        logInfo('[Monicredit Poller] Swept stale pending txns to abandoned', {
          count: swept.length,
          cutoff
        });
      }

      // Active pendings to verify this tick
      const { data: pendings, error } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, monicredit_order_id, amount, user_id, car_id, payment_type, metadata, created_at')
        .eq('payment_gateway', PAYMENT_GATEWAY.MONICREDIT)
        .eq('status', PAYMENT_STATUS.PENDING)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(this.batchSize);

      if (error) {
        this.stats.errors++;
        logError('[Monicredit Poller] Failed to query pending txns', { error: error.message });
        return;
      }

      if (!pendings || pendings.length === 0) {
        logDebug('[Monicredit Poller] No pending Monicredit txns to verify');
        return;
      }

      logDebug('[Monicredit Poller] Verifying batch', { count: pendings.length });

      for (const txn of pendings) {
        await this.processTxn(txn).catch(err => {
          this.stats.errors++;
          logError('[Monicredit Poller] processTxn failed', {
            reference: txn.reference,
            error: err.message
          });
        });
      }
    } finally {
      this.isTicking = false;
    }
  }

  async processTxn(txn) {
    const lookupId = txn.monicredit_order_id || txn.reference;

    let verifyResult;
    try {
      verifyResult = await MonicreditAdapter.verifyPayment(lookupId);
    } catch (error) {
      // Transport error — leave the txn pending and try again next tick.
      logDebug('[Monicredit Poller] Verify transport error — will retry', {
        reference: txn.reference,
        error: error.message
      });
      return;
    }

    if (verifyResult.state === 'pending') {
      logDebug('[Monicredit Poller] Still pending', { reference: txn.reference });
      return;
    }

    if (verifyResult.state === 'failed' || verifyResult.state === 'unknown') {
      await updateTransactionStatus(txn.reference, { status: PAYMENT_STATUS.FAILED });
      this.stats.failed++;
      await logPaymentAudit({
        eventType: 'poller_failed',
        transactionId: txn.id,
        reference: txn.reference,
        userId: txn.user_id,
        paymentGateway: 'monicredit',
        amountKobo: txn.amount,
        statusBefore: PAYMENT_STATUS.PENDING,
        statusAfter: PAYMENT_STATUS.FAILED,
        metadata: { state: verifyResult.state, inner_status: verifyResult.status }
      }).catch(err => logError('[Monicredit Poller] Audit log failed', { error: err.message }));
      logInfo('[Monicredit Poller] Marked failed', {
        reference: txn.reference,
        state: verifyResult.state,
        inner_status: verifyResult.status
      });
      return;
    }

    // state === 'approved' — fulfilment path
    await this.fulfil(txn, verifyResult);
  }

  async fulfil(txn, verifyResult) {
    // Amount validation — mirrors the webhook handler's tolerance logic so the
    // poller never accepts a payment the webhook would reject.
    const monicreditAmount = verifyResult.amount || 0;
    if (monicreditAmount > 0) {
      const toleranceBps = parseInt(process.env.MONICREDIT_AMOUNT_TOLERANCE_BPS || '200', 10);
      const toleranceKobo = Math.max(1, Math.round((txn.amount * toleranceBps) / 10000));
      try {
        validatePaymentAmount(txn.amount, monicreditAmount, toleranceKobo);
      } catch (error) {
        if (error instanceof AmountValidationError) {
          logError('[Monicredit Poller] Amount mismatch beyond tolerance — refusing to credit', {
            reference: txn.reference,
            expected_kobo: txn.amount,
            actual_kobo: monicreditAmount,
            difference_kobo: error.difference,
            tolerance_kobo: toleranceKobo,
            tolerance_bps: toleranceBps
          });
          this.stats.errors++;
          return;
        }
        throw error;
      }
    }

    let metadata = {};
    try {
      metadata = typeof txn.metadata === 'string' ? JSON.parse(txn.metadata) : (txn.metadata || {});
    } catch {
      logError('[Monicredit Poller] Bad metadata JSON — refusing to credit', { reference: txn.reference });
      return;
    }

    const isSubscription = metadata.subscription_id || metadata.is_subscription;
    const isPlateNumber = metadata.payment_type === 'plate_number' || txn.payment_type === PAYMENT_TYPE.PLATE_NUMBER;
    const isDriverLicense = metadata.payment_type === 'driver_license' || txn.payment_type === PAYMENT_TYPE.DRIVER_LICENSE;
    const orderType = isDriverLicense
      ? ORDER_TYPE.DRIVER_LICENSE
      : isPlateNumber
        ? ORDER_TYPE.PLATE_NUMBER
        : (isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL);

    const duplicateOrder = await findRecentActiveOrder({
      carId: txn.car_id,
      userId: txn.user_id,
      paymentType: orderType
    });
    if (duplicateOrder) {
      logError('[Monicredit Poller] Recent active order exists — refusing duplicate credit', {
        reference: txn.reference,
        car_id: txn.car_id,
        existing_order: duplicateOrder.order_number,
        existing_order_status: duplicateOrder.status,
        existing_order_age_minutes: Math.round((Date.now() - new Date(duplicateOrder.created_at).getTime()) / 60000)
      });
      // Mark the txn as failed since the other order has already fulfilled the purchase
      await updateTransactionStatus(txn.reference, { status: PAYMENT_STATUS.FAILED });
      return;
    }

    const paymentScheduleIds =
      metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];

    await updateTransactionStatus(txn.reference, {
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel: verifyResult.channel || 'bank_transfer',
      authorization_code: null,
      paid_at: verifyResult.date_paid || new Date().toISOString()
    });

    const processResult = await processPaymentSuccess({
      reference: txn.reference,
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel: verifyResult.channel || 'bank_transfer',
      authorization_code: null,
      paid_at: verifyResult.date_paid || new Date().toISOString(),
      orderType,
      renewalMonths: metadata.renewal_months || 12,
      selectedItems: paymentScheduleIds,
      renewalAmount: metadata.renewal_amount || txn.amount,
      deliveryFee: metadata.delivery_fee || 0,
      deliveryAddress: metadata.delivery_details?.address || metadata.delivery_address,
      deliveryState: metadata.delivery_details?.state || metadata.delivery_state,
      deliveryLGA: metadata.delivery_details?.lga || metadata.delivery_lga,
      deliveryContact: metadata.delivery_details?.contact || metadata.delivery_contact,
      metadata,
      renewalState: metadata.renewal_state || null
    });

    const updatedTxn = await getTransactionByReference(txn.reference);
    const createdOrder = processResult.orderId
      ? await getOrderById(processResult.orderId).catch(() => null)
      : null;

    if (!processResult.alreadyProcessed) {
      try {
        await PaymentSuccessService.processPaymentSuccessSideEffects({
          transaction: updatedTxn,
          gatewayData: verifyResult,
          order: createdOrder
        });
      } catch (notifyError) {
        // Payment is committed; notifications must not block the credit
        logError('[Monicredit Poller] Side-effects failed (non-fatal)', {
          reference: txn.reference,
          error: notifyError.message
        });
      }
    }

    await logPaymentAudit({
      eventType: 'poller_success',
      transactionId: updatedTxn.id,
      reference: txn.reference,
      userId: updatedTxn.user_id,
      paymentGateway: 'monicredit',
      amountKobo: updatedTxn.amount,
      statusBefore: PAYMENT_STATUS.PENDING,
      statusAfter: PAYMENT_STATUS.SUCCESSFUL,
      metadata: { orderId: processResult.orderId, source: 'poller' }
    }).catch(err => logError('[Monicredit Poller] Audit log failed', { error: err.message }));

    this.stats.approved++;
    logInfo('[Monicredit Poller] Credited', {
      reference: txn.reference,
      orderId: processResult.orderId,
      amount_kobo: updatedTxn.amount
    });
  }
}

export const monicreditPoller = new MonicreditPoller();
