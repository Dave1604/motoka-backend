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
import { PaystackAdapter } from './paystack.adapter.js';

export class PaystackPoller {
  constructor() {
    this.intervalMs = parseInt(process.env.PAYSTACK_POLLER_INTERVAL_MS || '60000', 10);
    this.maxAgeHours = parseInt(process.env.PAYSTACK_POLLER_MAX_AGE_HOURS || '24', 10);
    this.batchSize = parseInt(process.env.PAYSTACK_POLLER_BATCH_SIZE || '20', 10);
    this.tickInterval = null;
    this.isRunning = false;
    this.isTicking = false;
    this.stats = { ticks: 0, approved: 0, recovered: 0, swept: 0, errors: 0 };
  }

  start() {
    if (this.isRunning) return;
    if (process.env.PAYSTACK_POLLER_ENABLED === 'false') {
      logInfo('[Paystack Poller] Disabled via PAYSTACK_POLLER_ENABLED=false');
      return;
    }
    this.isRunning = true;
    this.tick().catch((err) => logError('[Paystack Poller] Initial tick failed', { error: err.message }));
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) => logError('[Paystack Poller] Tick failed', { error: err.message }));
    }, this.intervalMs);
    logInfo('[Paystack Poller] Starting', { intervalMs: this.intervalMs });
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

      const { data: swept, error: sweepError } = await supabaseAdmin
        .from('payment_transactions')
        .update({
          status: PAYMENT_STATUS.ABANDONED,
          cancellation_reason: 'user_abandoned',
          updated_at: new Date().toISOString(),
        })
        .eq('payment_gateway', PAYMENT_GATEWAY.PAYSTACK)
        .eq('status', PAYMENT_STATUS.PENDING)
        .lt('created_at', cutoff)
        .select('id');
      if (sweepError) {
        this.stats.errors++;
        logError('[Paystack Poller] Sweep failed', { error: sweepError.message });
      } else if (swept?.length) {
        this.stats.swept += swept.length;
      }

      // Fresh pendings to reconcile against the gateway API.
      const { data: pendings, error } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, paystack_reference, amount, user_id, car_id, payment_type, metadata, status, created_at')
        .eq('payment_gateway', PAYMENT_GATEWAY.PAYSTACK)
        .eq('status', PAYMENT_STATUS.PENDING)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(this.batchSize);

      // Abandoned rows touched inside the window: most are genuine drop-offs,
      // but some are races (unmount-cancel or duplicate-init beat the payment).
      // Verify them too — a gateway "success" recovers a paid customer the
      // webhook never reached. Rows abandoned long ago are left alone.
      const { data: abandoned, error: abandonedError } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, paystack_reference, amount, user_id, car_id, payment_type, metadata, status, created_at, updated_at')
        .eq('payment_gateway', PAYMENT_GATEWAY.PAYSTACK)
        .eq('status', PAYMENT_STATUS.ABANDONED)
        .gte('updated_at', cutoff)
        .order('updated_at', { ascending: true })
        .limit(this.batchSize);

      if (error) {
        this.stats.errors++;
        logError('[Paystack Poller] Failed to query pending txns', { error: error.message });
      }
      if (abandonedError) {
        this.stats.errors++;
        logError('[Paystack Poller] Failed to query abandoned txns', { error: abandonedError.message });
      }

      for (const txn of [...(pendings || []), ...(abandoned || [])]) {
        await this.processTxn(txn).catch((err) => {
          this.stats.errors++;
          logError('[Paystack Poller] processTxn failed', { reference: txn.reference, error: err.message });
        });
      }

      // Guest renewal orders are intentionally not handled here: the Monipay
      // poller already sweeps pending guest orders across every gateway.
    } finally {
      this.isTicking = false;
    }
  }

  async processTxn(txn) {
    let verifyResult;
    try {
      verifyResult = await PaystackAdapter.verifyPayment(txn.paystack_reference || txn.reference);
    } catch (error) {
      logDebug('[Paystack Poller] Verify transport error — will retry', {
        reference: txn.reference,
        error: error.message,
      });
      return;
    }

    // Not paid at the gateway. Nothing to do: unpaid pendings are swept at
    // maxAge, gateway-reported failures arrive via charge.failed, and rows
    // already abandoned are simply left as they are.
    if (!verifyResult.success) return;

    const gatewayAmount = verifyResult.amount || 0;
    if (gatewayAmount > 0) {
      try {
        validatePaymentAmount(txn.amount, gatewayAmount, 1);
      } catch (error) {
        if (error instanceof AmountValidationError) {
          logError('[Paystack Poller] Amount mismatch — refusing to credit', {
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

    // The ₦50 card-tokenization charge only exists to capture an auth code;
    // the webhook activates the subscription and refunds it. Never turn it
    // into an order.
    if (metadata.is_tokenization === true) {
      logDebug('[Paystack Poller] Skipping tokenization charge', { reference: txn.reference });
      return;
    }

    const wasAbandoned = txn.status === PAYMENT_STATUS.ABANDONED;
    if (wasAbandoned) {
      // The order-creating RPC expects status = pending; reset first exactly
      // like the webhook recovery path does.
      logInfo('[Paystack Poller] Recovering abandoned transaction — gateway confirms success', {
        reference: txn.reference,
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
        logError('[Paystack Poller] Side-effects failed (non-fatal)', {
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
      paymentGateway: PAYMENT_GATEWAY.PAYSTACK,
      amountKobo: updatedTxn.amount,
      statusBefore: wasAbandoned ? PAYMENT_STATUS.ABANDONED : PAYMENT_STATUS.PENDING,
      statusAfter: PAYMENT_STATUS.SUCCESSFUL,
      metadata: { orderId: processResult.orderId, source: 'poller' },
    }).catch((err) => logError('[Paystack Poller] Audit log failed', { error: err.message }));

    this.stats.approved++;
    if (wasAbandoned) this.stats.recovered++;
    logInfo('[Paystack Poller] Credited', {
      reference: txn.reference,
      orderId: processResult.orderId,
      recoveredAbandoned: wasAbandoned,
    });
  }
}

export const paystackPoller = new PaystackPoller();
