import { getWallet, getWalletLedger, payWithWallet as payWithWalletService, WalletError } from '../../services/wallet/wallet.service.js';
import { createTransaction, updateTransactionWithPaystackInit, getTransactionByReference, markTransactionAbandoned } from '../../services/payment/transaction.service.js';
import { initializeTransaction, PaystackError } from '../../services/payment/paystack.service.js';
import { validateRenewalItemsSelection } from '../../services/payment/renewalItems.service.js';
import { resolveStateAndLGA } from '../../services/location.service.js';
import { getOrderById, findRecentActiveOrder } from '../../services/payment/order.service.js';
import { PaymentSuccessService } from '../../services/payment/payment-success.service.js';
import { buildPaymentMetadata } from '../../utils/paymentHelpers.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import {
  computeFunding,
  validateFundingAmount,
  WALLET_FUNDING_MIN_KOBO,
  WALLET_FUNDING_MAX_KOBO
} from '../../utils/walletFee.js';
import { paymentResponse } from '../payment/payment-response.util.js';
import { PAYMENT_TYPE, PAYMENT_GATEWAY, ORDER_TYPE, ERROR_MESSAGES, HTTP_STATUS } from '../../constants/payment.constants.js';
import { logError, logInfo } from '../../utils/logger.js';

// Resolve a requested kobo amount from either amount_kobo (preferred) or a naira
// `amount`. Returns null if neither is a valid positive number.
function resolveKobo(source) {
  if (source == null) return null;
  if (source.amount_kobo != null) {
    const k = Number(source.amount_kobo);
    return Number.isFinite(k) ? Math.round(k) : null;
  }
  if (source.amount != null) {
    const n = Number(source.amount);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return null;
}

// GET /api/wallet
export const getWalletBalance = async (req, res) => {
  try {
    const wallet = await getWallet(req.user.id);
    return paymentResponse.success(res, {
      balance_kobo: wallet.balance_kobo,
      balance_naira: wallet.balance_kobo / 100,
      status: wallet.status,
      currency: wallet.currency
    }, 'Wallet retrieved');
  } catch (error) {
    logError('[Wallet] getWalletBalance error', { error: error.message });
    return paymentResponse.serverError(res, 'Failed to retrieve wallet');
  }
};

// GET /api/wallet/ledger?page=&limit=
export const getLedger = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const result = await getWalletLedger(req.user.id, { page, limit });
    return paymentResponse.success(res, result, 'Ledger retrieved');
  } catch (error) {
    logError('[Wallet] getLedger error', { error: error.message });
    return paymentResponse.serverError(res, 'Failed to retrieve ledger');
  }
};

// GET /api/wallet/fund/quote?amount_kobo= (or ?amount= in naira)
// Returns the transparent breakdown: credit + fee = total charge.
export const getFundingQuote = async (req, res) => {
  try {
    const desiredKobo = resolveKobo(req.query);
    if (desiredKobo == null) {
      return paymentResponse.error(res, 'Provide amount_kobo (or amount in naira).', HTTP_STATUS.BAD_REQUEST);
    }
    const { valid, error } = validateFundingAmount(desiredKobo);
    if (!valid) return paymentResponse.error(res, error, HTTP_STATUS.BAD_REQUEST);

    const quote = computeFunding(desiredKobo);
    return paymentResponse.success(res, {
      credit_kobo: quote.desiredKobo,
      fee_kobo: quote.feeKobo,
      total_charge_kobo: quote.chargeKobo,
      credit_naira: quote.desiredKobo / 100,
      fee_naira: quote.feeKobo / 100,
      total_charge_naira: quote.chargeKobo / 100,
      min_kobo: WALLET_FUNDING_MIN_KOBO,
      max_kobo: WALLET_FUNDING_MAX_KOBO
    }, 'Funding quote');
  } catch (error) {
    logError('[Wallet] getFundingQuote error', { error: error.message });
    return paymentResponse.serverError(res, 'Failed to compute quote');
  }
};

// POST /api/wallet/pay  → pay for a car renewal from wallet balance.
// Body mirrors /payments/initialize (renewal): car_slug, payment_schedule_id,
// renewal_months, delivery_details, renewal_state.
export const payWithWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      car_slug,
      payment_schedule_id = [],
      renewal_months: rawRenewalMonths,
      delivery_details,
      meta_data,
      renewal_state = null
    } = req.body;

    // Renewal items → amount (kobo). Same validation as the gateway flow.
    const validation = await validateRenewalItemsSelection(payment_schedule_id);
    if (!validation.valid) return paymentResponse.error(res, validation.error, HTTP_STATUS.BAD_REQUEST);

    const VALID_RENEWAL_MONTHS = [1, 3, 6, 12, 24];
    const parsedMonths = parseInt(rawRenewalMonths);
    const renewalMonths = !rawRenewalMonths || isNaN(parsedMonths) ? 12
      : (VALID_RENEWAL_MONTHS.includes(parsedMonths) ? parsedMonths : null);
    if (renewalMonths === null) {
      return paymentResponse.error(res, `Invalid renewal_months. Must be one of: ${VALID_RENEWAL_MONTHS.join(', ')}`, HTTP_STATUS.BAD_REQUEST);
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!car_slug) return paymentResponse.error(res, 'car_slug is required', HTTP_STATUS.BAD_REQUEST);
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('id, slug, user_id')
      .eq('slug', car_slug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();
    if (carError || !car) return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);

    // Optional delivery — validate + fee, same as init.
    const deliveryData = delivery_details || meta_data || {};
    let deliveryFee = 0;
    let hasDeliveryDetails = !!(deliveryData && (deliveryData.address || deliveryData.state || deliveryData.state_id || deliveryData.lga || deliveryData.lga_id || deliveryData.contact));
    if (hasDeliveryDetails) {
      const stateInput = deliveryData.state_id !== undefined ? deliveryData.state_id : deliveryData.state;
      const lgaInput = deliveryData.lga_id !== undefined ? deliveryData.lga_id : deliveryData.lga;
      const stateValidation = await resolveStateAndLGA(stateInput, lgaInput);
      if (!stateValidation.valid) return paymentResponse.error(res, stateValidation.error, HTTP_STATUS.BAD_REQUEST);
      deliveryFee = stateValidation.delivery_fee || 0;
      deliveryData.state = stateValidation.stateCode || deliveryData.state;
      deliveryData.lga = stateValidation.lgaName || deliveryData.lga;
    }

    const renewalAmount = validation.total;
    const amount = renewalAmount + deliveryFee;

    // Fast, friendly pre-checks (the RPC is the source of truth and re-checks atomically).
    const wallet = await getWallet(userId);
    if (wallet.status === 'frozen') return paymentResponse.error(res, 'Your wallet is frozen. Please contact support.', HTTP_STATUS.FORBIDDEN);
    if (wallet.balance_kobo < amount) {
      return paymentResponse.error(res, `Insufficient wallet balance. You have ₦${(wallet.balance_kobo / 100).toLocaleString()} but need ₦${(amount / 100).toLocaleString()}.`, HTTP_STATUS.BAD_REQUEST);
    }

    // Refuse a duplicate active order for this car (mirrors the gateway success guard).
    const duplicate = await findRecentActiveOrder({ carId: car.id, userId, paymentType: ORDER_TYPE.RENEWAL_MANUAL });
    if (duplicate) {
      return paymentResponse.error(res, `An active renewal order already exists for this car (${duplicate.order_number}).`, HTTP_STATUS.CONFLICT);
    }

    const metadata = buildPaymentMetadata({
      carId: car.id, carSlug: car.slug, paymentType: PAYMENT_TYPE.RENEWAL_MANUAL,
      renewalMonths, paymentScheduleId: payment_schedule_id, renewalAmount, deliveryFee,
      deliveryDetails: hasDeliveryDetails ? deliveryData : null, userId, renewalState: renewal_state
    });

    const transaction = await createTransaction({
      userId, carId: car.id, amount, paymentType: PAYMENT_TYPE.RENEWAL_MANUAL,
      paymentGateway: PAYMENT_GATEWAY.WALLET, metadata
    });

    let result;
    try {
      result = await payWithWalletService({
        userId, reference: transaction.reference, amountKobo: amount, transactionId: transaction.id,
        orderType: ORDER_TYPE.RENEWAL_MANUAL, renewalMonths, selectedItems: payment_schedule_id,
        renewalAmount, deliveryFee,
        deliveryAddress: hasDeliveryDetails ? (deliveryData.address || null) : null,
        deliveryState: hasDeliveryDetails ? (deliveryData.state || null) : null,
        deliveryLGA: hasDeliveryDetails ? (deliveryData.lga || null) : null,
        deliveryContact: hasDeliveryDetails ? (deliveryData.contact || deliveryData.delivery_contact || null) : null,
        metadata, renewalState: renewal_state
      });
    } catch (payErr) {
      // Debit + fulfillment are atomic in the RPC, so a failure means nothing was
      // debited. Just abandon the pending transaction row.
      await markTransactionAbandoned(transaction.reference, 'gateway_failure').catch(() => {});
      throw payErr;
    }

    const order = result.orderId ? await getOrderById(result.orderId).catch(() => null) : null;

    if (!result.alreadyProcessed) {
      try {
        const updatedTransaction = await getTransactionByReference(transaction.reference);
        await PaymentSuccessService.processPaymentSuccessSideEffects({
          transaction: updatedTransaction, gatewayData: { channel: 'wallet' }, order
        });
      } catch (sideErr) {
        logError('[Wallet Pay] side effects failed (non-fatal)', { error: sideErr.message, reference: transaction.reference });
      }
    }

    logInfo('[Wallet Pay] Paid from wallet', { reference: transaction.reference, userId, amount, balanceAfter: result.balanceAfter, orderId: result.orderId });

    return paymentResponse.success(res, {
      reference: transaction.reference,
      order_id: result.orderId,
      order_number: order?.order_number || null,
      amount_kobo: amount,
      balance_kobo: result.balanceAfter,
      already_processed: result.alreadyProcessed
    }, 'Payment successful');
  } catch (error) {
    if (error instanceof WalletError) {
      return paymentResponse.error(res, error.message, error.statusCode || 500);
    }
    logError('[Wallet Pay] error', { error: error.message });
    return paymentResponse.serverError(res, 'Failed to complete wallet payment');
  }
};

// POST /api/wallet/fund  { amount_kobo }  → Paystack checkout for (credit + fee)
export const initFunding = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const desiredKobo = resolveKobo(req.body);
    if (desiredKobo == null) {
      return paymentResponse.error(res, 'Provide amount_kobo (or amount in naira).', HTTP_STATUS.BAD_REQUEST);
    }

    const wallet = await getWallet(userId);
    if (wallet.status === 'frozen') {
      return paymentResponse.error(res, 'Your wallet is frozen. Please contact support.', HTTP_STATUS.FORBIDDEN);
    }
    const { valid, error } = validateFundingAmount(desiredKobo, wallet.balance_kobo);
    if (!valid) return paymentResponse.error(res, error, HTTP_STATUS.BAD_REQUEST);

    const { feeKobo, chargeKobo } = computeFunding(desiredKobo);

    // The transaction amount is the GROSS charge (credit + fee). The amount to
    // land in the wallet is carried in metadata and applied on verified success.
    const transaction = await createTransaction({
      userId,
      carId: null,
      amount: chargeKobo,
      paymentType: PAYMENT_TYPE.WALLET_FUNDING,
      paymentGateway: PAYMENT_GATEWAY.PAYSTACK,
      metadata: {
        payment_type: PAYMENT_TYPE.WALLET_FUNDING,
        wallet_credit_kobo: desiredKobo,
        fee_kobo: feeKobo
      }
    });

    const callbackUrl = process.env.WALLET_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || undefined;
    const init = await initializeTransaction({
      email: userEmail,
      amount: chargeKobo,
      reference: transaction.reference,
      callback_url: callbackUrl,
      metadata: {
        payment_type: PAYMENT_TYPE.WALLET_FUNDING,
        wallet_credit_kobo: desiredKobo,
        fee_kobo: feeKobo,
        user_id: userId
      },
      // Card + bank transfer + USSD by default. Override via env without a redeploy.
      // The fee gross-up is computed at the (higher) card rate, so the wallet is
      // always fully funded regardless of which channel the user picks.
      channels: (process.env.WALLET_FUNDING_CHANNELS || 'card,bank_transfer,ussd')
        .split(',').map((c) => c.trim()).filter(Boolean)
    });

    await updateTransactionWithPaystackInit(transaction.reference, init);

    logInfo('[Wallet] Funding initialized', { reference: transaction.reference, userId, desiredKobo, chargeKobo });

    return paymentResponse.success(res, {
      reference: transaction.reference,
      authorization_url: init.authorization_url,
      access_code: init.access_code,
      credit_kobo: desiredKobo,
      fee_kobo: feeKobo,
      total_charge_kobo: chargeKobo
    }, 'Wallet funding initialized');
  } catch (error) {
    if (error instanceof PaystackError || error instanceof WalletError) {
      return paymentResponse.error(res, error.message, error.statusCode || 500);
    }
    logError('[Wallet] initFunding error', { error: error.message });
    return paymentResponse.serverError(res, 'Failed to initialize wallet funding');
  }
};
