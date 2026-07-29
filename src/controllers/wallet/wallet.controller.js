import { getWallet, getWalletLedger, WalletError } from '../../services/wallet/wallet.service.js';
import { createTransaction, updateTransactionWithPaystackInit } from '../../services/payment/transaction.service.js';
import { initializeTransaction, PaystackError } from '../../services/payment/paystack.service.js';
import {
  computeFunding,
  validateFundingAmount,
  WALLET_FUNDING_MIN_KOBO,
  WALLET_FUNDING_MAX_KOBO
} from '../../utils/walletFee.js';
import { paymentResponse } from '../payment/payment-response.util.js';
import { PAYMENT_TYPE, PAYMENT_GATEWAY, HTTP_STATUS } from '../../constants/payment.constants.js';
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
      channels: ['card']
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
