import { getSupabaseAdmin } from '../../../config/supabase.js';
import { logInfo, logError, logDebug } from '../../../utils/logger.js';
import {
  PAYMENT_STATUS,
  PAYMENT_GATEWAY,
  PAYMENT_TYPE,
  ORDER_TYPE,
} from '../../../constants/payment.constants.js';
import {
  processPaymentSuccess,
  updateTransactionStatus,
  getTransactionByReference,
} from '../transaction.service.js';
import { getOrderById } from '../order.service.js';
import { handleWalletFundingSuccess } from '../../wallet/wallet.service.js';
import { validatePaymentAmount, AmountValidationError } from '../validation/amount.validator.js';
import { PaymentSuccessService } from '../payment-success.service.js';
import { logPaymentAudit } from '../audit.service.js';
import { MonipayAdapter } from './index.js';
import { verifyGuestPayment } from '../../guest/guestRenewal.service.js';

class MonipayPoller {
  constructor() {
    this.intervalMs = parseInt(process.env.MONIPAY_POLLER_INTERVAL_MS || '60000', 10);
    this.maxAgeHours = parseInt(process.env.MONIPAY_POLLER_MAX_AGE_HOURS || '24', 10);
    this.batchSize = parseInt(process.env.MONIPAY_POLLER_BATCH_SIZE || '20', 10);
    this.tickInterval = null;
    this.isRunning = false;
    this.isTicking = false;
    this.stats = { ticks: 0, approved: 0, failed: 0, swept: 0, errors: 0 };
  }

  start() {
    if (this.isRunning) return;
    if (process.env.MONIPAY_POLLER_ENABLED === 'false') {
      logInfo('[Monipay Poller] Disabled via MONIPAY_POLLER_ENABLED=false');
      return;
    }
    this.isRunning = true;
    this.tick().catch((err) => logError('[Monipay Poller] Initial tick failed', { error: err.message }));
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) => logError('[Monipay Poller] Tick failed', { error: err.message }));
    }, this.intervalMs);
    logInfo('[Monipay Poller] Starting', { intervalMs: this.intervalMs });
  }

  stop() {
    if (!this.isRunning) return;
    clearInterval(this.tickInterval);
    this.tickInterval = null;
    this.isRunning = false;
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    this.stats.ticks++;
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const cutoff = new Date(Date.now() - this.maxAgeHours * 3600 * 1000).toISOString();

      await supabaseAdmin
        .from('payment_transactions')
        .update({
          status: PAYMENT_STATUS.ABANDONED,
          cancellation_reason: 'user_abandoned',
          updated_at: new Date().toISOString(),
        })
        .eq('payment_gateway', PAYMENT_GATEWAY.MONIPAY)
        .eq('status', PAYMENT_STATUS.PENDING)
        .lt('created_at', cutoff);

      const { data: pendings, error } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, amount, user_id, car_id, payment_type, metadata, status, created_at')
        .eq('payment_gateway', PAYMENT_GATEWAY.MONIPAY)
        .eq('status', PAYMENT_STATUS.PENDING)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(this.batchSize);

      if (error) {
        this.stats.errors++;
        logError('[Monipay Poller] Failed to query pending txns', { error: error.message });
      }

      // Rows we gave up on inside the window. Monipay reports an unfinished
      // checkout as failed/abandoned while a bank transfer is still on its way,
      // so a row marked failed or abandoned can still turn into a payment. Keep
      // verifying those until the window closes — the wallet top-ups lost in
      // November 2026 were exactly this.
      const { data: givenUp, error: givenUpError } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, amount, user_id, car_id, payment_type, metadata, status, created_at, updated_at')
        .eq('payment_gateway', PAYMENT_GATEWAY.MONIPAY)
        .in('status', [PAYMENT_STATUS.FAILED, PAYMENT_STATUS.ABANDONED])
        .gte('updated_at', cutoff)
        .order('updated_at', { ascending: true })
        .limit(this.batchSize);

      if (givenUpError) {
        this.stats.errors++;
        logError('[Monipay Poller] Failed to query failed/abandoned txns', { error: givenUpError.message });
      }

      for (const txn of [...(pendings || []), ...(givenUp || [])]) {
        await this.processTxn(txn).catch((err) => {
          this.stats.errors++;
          logError('[Monipay Poller] processTxn failed', { reference: txn.reference, error: err.message });
        });
      }

      await this.processGuestOrders(supabaseAdmin, cutoff);
    } finally {
      this.isTicking = false;
    }
  }

  async processTxn(txn) {
    let verifyResult;
    try {
      verifyResult = await MonipayAdapter.verifyPayment(txn.reference);
    } catch (error) {
      logDebug('[Monipay Poller] Verify transport error — will retry', {
        reference: txn.reference,
        error: error.message,
      });
      return;
    }

    // Only a gateway "failed" on a pending row is worth recording. "abandoned"
    // just means the checkout page was closed; the transfer may still land, so
    // the row stays pending until the sweep. Rows already failed/abandoned are
    // left as they are.
    if (!verifyResult.success) {
      if (verifyResult.status === 'failed' && txn.status === PAYMENT_STATUS.PENDING) {
        await updateTransactionStatus(txn.reference, { status: PAYMENT_STATUS.FAILED });
        this.stats.failed++;
      }
      return;
    }

    const gatewayAmount = verifyResult.amount || 0;
    if (gatewayAmount > 0) {
      try {
        validatePaymentAmount(txn.amount, gatewayAmount, 1);
      } catch (error) {
        if (error instanceof AmountValidationError) {
          logError('[Monipay Poller] Amount mismatch — refusing to credit', {
            reference: txn.reference,
            expected_kobo: txn.amount,
            actual_kobo: gatewayAmount,
          });
          return;
        }
        throw error;
      }
    }

    let metadata = {};
    try {
      metadata = typeof txn.metadata === 'string' ? JSON.parse(txn.metadata) : (txn.metadata || {});
    } catch {
      return;
    }

    const priorStatus = txn.status || PAYMENT_STATUS.PENDING;
    if (priorStatus !== PAYMENT_STATUS.PENDING) {
      // The order-creating RPC expects status = pending; reset first exactly
      // like the webhook recovery path does.
      logInfo('[Monipay Poller] Recovering given-up transaction — gateway confirms success', {
        reference: txn.reference,
        priorStatus,
      });
      await updateTransactionStatus(txn.reference, { status: PAYMENT_STATUS.PENDING });
    }

    // Wallet top-ups credit the ledger; they must never reach the order RPC.
    if (metadata.payment_type === PAYMENT_TYPE.WALLET_FUNDING || txn.payment_type === PAYMENT_TYPE.WALLET_FUNDING) {
      await handleWalletFundingSuccess(txn, verifyResult, metadata);
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

    const processResult = await processPaymentSuccess({
      reference: txn.reference,
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel: verifyResult.channel || 'card',
      authorization_code: verifyResult.authorization?.authorization_code || null,
      paid_at: verifyResult.paid_at || new Date().toISOString(),
      orderType,
      renewalMonths: metadata.renewal_months || 12,
      selectedItems: metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [],
      renewalAmount: metadata.renewal_amount || txn.amount,
      deliveryFee: metadata.delivery_fee || 0,
      deliveryAddress: metadata.delivery_details?.address || metadata.delivery_address,
      deliveryState: metadata.delivery_details?.state || metadata.delivery_state,
      deliveryLGA: metadata.delivery_details?.lga || metadata.delivery_lga,
      deliveryContact: metadata.delivery_details?.contact || metadata.delivery_contact,
      metadata,
      renewalState: metadata.renewal_state || null,
    });

    const updatedTxn = await getTransactionByReference(txn.reference);
    const createdOrder = processResult.orderId
      ? await getOrderById(processResult.orderId).catch(() => null)
      : null;

    if (!processResult.alreadyProcessed) {
      await PaymentSuccessService.processPaymentSuccessSideEffects({
        transaction: updatedTxn,
        gatewayData: verifyResult,
        order: createdOrder,
      }).catch((notifyError) => {
        logError('[Monipay Poller] Side-effects failed (non-fatal)', {
          reference: txn.reference,
          error: notifyError.message,
        });
      });
    }

    await logPaymentAudit({
      eventType: 'poller_success',
      transactionId: updatedTxn.id,
      reference: txn.reference,
      userId: updatedTxn.user_id,
      paymentGateway: PAYMENT_GATEWAY.MONIPAY,
      amountKobo: updatedTxn.amount,
      statusBefore: priorStatus,
      statusAfter: PAYMENT_STATUS.SUCCESSFUL,
      metadata: { orderId: processResult.orderId, source: 'poller' },
    }).catch((err) => logError('[Monipay Poller] Audit log failed', { error: err.message }));

    this.stats.approved++;
    logInfo('[Monipay Poller] Credited', { reference: txn.reference, orderId: processResult.orderId });
  }

  async processGuestOrders(supabaseAdmin, cutoff) {
    const { data: guests, error } = await supabaseAdmin
      .from('guest_renewal_orders')
      .select('id, payment_reference, payment_gateway, payment_status, created_at')
      .eq('payment_status', 'pending_payment')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(this.batchSize);

    if (error) {
      this.stats.errors++;
      return;
    }

    for (const order of guests || []) {
      try {
        const result = await verifyGuestPayment(order.id, order.payment_reference);
        if (result.status === 'payment_success') this.stats.approved++;
        else if (result.status === 'payment_failed') this.stats.failed++;
      } catch (err) {
        if (err.statusCode !== 410) {
          this.stats.errors++;
          logError('[Monipay Poller] Guest verify failed', { guestOrderId: order.id, error: err.message });
        }
      }
    }
  }
}

export const monipayPoller = new MonipayPoller();
