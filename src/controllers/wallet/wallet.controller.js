import { getWallet, getWalletLedger, payWithWallet as payWithWalletService, WalletError } from '../../services/wallet/wallet.service.js';
import { createTransaction, updateTransactionWithPaystackInit, getTransactionByReference, markTransactionAbandoned } from '../../services/payment/transaction.service.js';
import { initializeTransaction, PaystackError } from '../../services/payment/paystack.service.js';
import { validateRenewalItemsSelection } from '../../services/payment/renewalItems.service.js';
import { quoteFromDeliveryFields, DeliveryQuoteError } from '../../services/courier/deliveryQuote.service.js';
import { TerminalError } from '../../services/courier/terminal.service.js';
import { getOrderById, findRecentActiveOrder } from '../../services/payment/order.service.js';
import { PaymentSuccessService } from '../../services/payment/payment-success.service.js';
import { buildPaymentMetadata, nairaToKobo } from '../../utils/paymentHelpers.js';
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

// Kobo -> "₦20,000.00", for the human-readable rows shown on the Paystack
// transaction. Display only; every stored amount stays in kobo.
function formatNaira(kobo) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

// POST /api/wallet/pay  → pay for a renewal, plate, or driver license from wallet.
export const payWithWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      car_slug,
      payment_schedule_id = [],
      renewal_months: rawRenewalMonths,
      delivery_details,
      meta_data,
      renewal_state = null,
      payment_type = PAYMENT_TYPE.RENEWAL_MANUAL,
      plate_type = null,
      sub_type = null,
      license_type = null,
      duration = null,
    } = req.body;

    const isPlatePayment = payment_type === PAYMENT_TYPE.PLATE_NUMBER || payment_type === 'plate_number';
    const isDriverLicensePayment = payment_type === PAYMENT_TYPE.DRIVER_LICENSE || payment_type === 'driver_license';
    const paymentType = isPlatePayment
      ? PAYMENT_TYPE.PLATE_NUMBER
      : isDriverLicensePayment
        ? PAYMENT_TYPE.DRIVER_LICENSE
        : PAYMENT_TYPE.RENEWAL_MANUAL;
    const orderType = isPlatePayment
      ? ORDER_TYPE.PLATE_NUMBER
      : isDriverLicensePayment
        ? ORDER_TYPE.DRIVER_LICENSE
        : ORDER_TYPE.RENEWAL_MANUAL;
    const quotePurpose = isPlatePayment ? 'plate_number' : isDriverLicensePayment ? 'driver_license' : 'renewal';

    const supabaseAdmin = getSupabaseAdmin();
    let car = null;
    let selectedItems = [];
    let renewalMonths = 0;
    let renewalAmount = 0;
    let plateType = null;
    let subType = null;
    let licenseType = null;
    let licenseDuration = null;

    if (isPlatePayment) {
      if (!plate_type) {
        return paymentResponse.error(res, 'plate_type is required for plate number payments', HTTP_STATUS.BAD_REQUEST);
      }
      if (!car_slug) return paymentResponse.error(res, 'car_slug is required', HTTP_STATUS.BAD_REQUEST);
      const { data: carRow, error: carError } = await supabaseAdmin
        .from('cars')
        .select('id, slug, user_id')
        .eq('slug', car_slug)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();
      if (carError || !carRow) return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
      car = carRow;

      let priceQuery = supabaseAdmin.from('plate_number_prices').select('*').eq('plate_type', plate_type);
      if (sub_type) priceQuery = priceQuery.eq('sub_type', sub_type);
      else priceQuery = priceQuery.is('sub_type', null);
      const { data: priceData, error: priceError } = await priceQuery.single();
      if (priceError || !priceData) {
        return paymentResponse.error(
          res,
          `No price configured for plate type "${plate_type}"${sub_type ? ` / sub-type "${sub_type}"` : ''}`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
      renewalAmount = nairaToKobo(Number(priceData.price));
      plateType = plate_type;
      subType = sub_type || null;
    } else if (isDriverLicensePayment) {
      const validTypes = ['new', 'renew'];
      const validDurations = ['3yr', '5yr', 'international'];
      if (!license_type || !validTypes.includes(String(license_type).toLowerCase())) {
        return paymentResponse.error(res, 'license_type is required and must be "new" or "renew"', HTTP_STATUS.BAD_REQUEST);
      }
      if (!duration) {
        return paymentResponse.error(res, `duration is required. Must be one of: ${validDurations.join(', ')}`, HTTP_STATUS.BAD_REQUEST);
      }
      const normDuration = String(duration).toLowerCase();
      if (!validDurations.includes(normDuration)) {
        return paymentResponse.error(res, `duration must be one of: ${validDurations.join(', ')}`, HTTP_STATUS.BAD_REQUEST);
      }
      const { data: priceData, error: priceError } = await supabaseAdmin
        .from('driver_license_prices')
        .select('*')
        .eq('license_type', String(license_type).toLowerCase())
        .eq('duration', normDuration)
        .eq('is_active', true)
        .single();
      if (priceError || !priceData) {
        return paymentResponse.error(
          res,
          `No price configured for driver license type "${license_type}" / duration "${normDuration}"`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
      renewalAmount = nairaToKobo(Number(priceData.price));
      licenseType = String(license_type).toLowerCase();
      licenseDuration = normDuration;
    } else {
      const validation = await validateRenewalItemsSelection(payment_schedule_id);
      if (!validation.valid) return paymentResponse.error(res, validation.error, HTTP_STATUS.BAD_REQUEST);

      const VALID_RENEWAL_MONTHS = [1, 3, 6, 12, 24];
      const parsedMonths = parseInt(rawRenewalMonths);
      renewalMonths = !rawRenewalMonths || isNaN(parsedMonths) ? 12
        : (VALID_RENEWAL_MONTHS.includes(parsedMonths) ? parsedMonths : null);
      if (renewalMonths === null) {
        return paymentResponse.error(res, `Invalid renewal_months. Must be one of: ${VALID_RENEWAL_MONTHS.join(', ')}`, HTTP_STATUS.BAD_REQUEST);
      }
      if (!car_slug) return paymentResponse.error(res, 'car_slug is required', HTTP_STATUS.BAD_REQUEST);
      const { data: carRow, error: carError } = await supabaseAdmin
        .from('cars')
        .select('id, slug, user_id')
        .eq('slug', car_slug)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();
      if (carError || !carRow) return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
      car = carRow;
      selectedItems = payment_schedule_id;
      renewalAmount = validation.total;
    }

    const deliveryData = delivery_details || meta_data || {};
    let deliveryFee = 0;
    let hasDeliveryDetails = !!(deliveryData && (deliveryData.address || deliveryData.delivery_address || deliveryData.state || deliveryData.state_id || deliveryData.lga || deliveryData.lga_id || deliveryData.contact || deliveryData.delivery_contact));
    if (hasDeliveryDetails) {
      let quote;
      try {
        quote = await quoteFromDeliveryFields(deliveryData, {
          purpose: quotePurpose,
          selectedItems,
        });
      } catch (quoteError) {
        if (quoteError instanceof DeliveryQuoteError || quoteError instanceof TerminalError) {
          return paymentResponse.error(res, quoteError.message, quoteError.statusCode || HTTP_STATUS.BAD_REQUEST);
        }
        throw quoteError;
      }
      deliveryFee = quote.fee_kobo;
      deliveryData.state = quote.stateCode;
      deliveryData.lga = quote.lgaName;
      deliveryData.address = quote.address;
      deliveryData.contact = quote.contact;
    }

    const amount = renewalAmount + deliveryFee;

    const wallet = await getWallet(userId);
    if (wallet.status === 'frozen') return paymentResponse.error(res, 'Your wallet is frozen. Please contact support.', HTTP_STATUS.FORBIDDEN);
    if (wallet.balance_kobo < amount) {
      return paymentResponse.error(res, `Insufficient wallet balance. You have ₦${(wallet.balance_kobo / 100).toLocaleString()} but need ₦${(amount / 100).toLocaleString()}.`, HTTP_STATUS.BAD_REQUEST);
    }

    const duplicate = await findRecentActiveOrder({
      carId: car?.id || null,
      userId,
      paymentType: orderType,
    });
    if (duplicate) {
      return paymentResponse.error(res, `An active order already exists (${duplicate.order_number}).`, HTTP_STATUS.CONFLICT);
    }

    const metadata = buildPaymentMetadata({
      carId: car?.id ?? null,
      carSlug: car?.slug ?? car_slug ?? null,
      paymentType,
      renewalMonths,
      paymentScheduleId: selectedItems,
      renewalAmount,
      deliveryFee,
      deliveryDetails: hasDeliveryDetails ? deliveryData : null,
      userId,
      plateType,
      subType,
      licenseType,
      licenseDuration,
      renewalState: (!isPlatePayment && !isDriverLicensePayment) ? renewal_state : null,
    });

    const transaction = await createTransaction({
      userId,
      carId: car?.id ?? null,
      amount,
      paymentType,
      paymentGateway: PAYMENT_GATEWAY.WALLET,
      metadata,
    });

    let result;
    try {
      result = await payWithWalletService({
        userId, reference: transaction.reference, amountKobo: amount, transactionId: transaction.id,
        orderType, renewalMonths, selectedItems,
        renewalAmount, deliveryFee,
        deliveryAddress: hasDeliveryDetails ? (deliveryData.address || null) : null,
        deliveryState: hasDeliveryDetails ? (deliveryData.state || null) : null,
        deliveryLGA: hasDeliveryDetails ? (deliveryData.lga || null) : null,
        deliveryContact: hasDeliveryDetails ? (deliveryData.contact || deliveryData.delivery_contact || null) : null,
        metadata, renewalState: renewal_state
      });
    } catch (payErr) {
      await markTransactionAbandoned(transaction.reference, 'gateway_failure').catch(() => {});
      throw payErr;
    }

    const order = result.orderId ? await getOrderById(result.orderId).catch(() => null) : null;

    if (isDriverLicensePayment && order?.id) {
      try {
        await supabaseAdmin
          .from('driver_license_applications')
          .update({ order_id: order.id, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('application_type', licenseType);
      } catch (linkErr) {
        logError('[Wallet Pay] Failed to link driver license application (non-fatal)', { error: linkErr.message, orderId: order.id });
      }
    }

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

    logInfo('[Wallet Pay] Paid from wallet', { reference: transaction.reference, userId, amount, balanceAfter: result.balanceAfter, orderId: result.orderId, paymentType });

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
    if (error instanceof TerminalError || error instanceof DeliveryQuoteError) {
      return paymentResponse.error(res, error.message, error.statusCode || 400);
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

    // Who paid. The reference stays opaque — it travels in callback URLs, webhook
    // bodies and logs, and is the idempotency key for wallet_credit(), so it is a
    // bad place for personal data. Paystack renders custom_fields as labelled rows
    // on the transaction instead, which is where someone reconciling actually looks.
    const profile = req.user.profile || {};
    const payerName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
    const customFields = [
      payerName && { display_name: 'Customer', variable_name: 'customer_name', value: payerName },
      profile.phone_number && { display_name: 'Phone', variable_name: 'phone', value: profile.phone_number },
      { display_name: 'Purpose', variable_name: 'purpose', value: 'Wallet top-up' },
      { display_name: 'Wallet credit', variable_name: 'wallet_credit', value: formatNaira(desiredKobo) },
      { display_name: 'Fee (paid by user)', variable_name: 'funding_fee', value: formatNaira(feeKobo) },
      { display_name: 'Motoka user ID', variable_name: 'motoka_user_id', value: userId }
    ].filter(Boolean);

    const init = await initializeTransaction({
      email: userEmail,
      amount: chargeKobo,
      reference: transaction.reference,
      callback_url: callbackUrl,
      first_name: profile.first_name || undefined,
      last_name: profile.last_name || undefined,
      phone: profile.phone_number || undefined,
      metadata: {
        payment_type: PAYMENT_TYPE.WALLET_FUNDING,
        wallet_credit_kobo: desiredKobo,
        fee_kobo: feeKobo,
        user_id: userId,
        custom_fields: customFields
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
