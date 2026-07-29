import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo, logWarn } from '../../utils/logger.js';
import { updateTransactionStatus } from '../payment/transaction.service.js';
import { logPaymentAudit } from '../payment/audit.service.js';
import { PAYMENT_STATUS } from '../../constants/payment.constants.js';

export class WalletError extends Error {
  constructor(message, statusCode = 500, code = 'WALLET_ERROR') {
    super(message);
    this.name = 'WalletError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Read a user's wallet. Returns a zeroed shape if they've never funded (no row
// exists yet) so callers don't special-case first-time users.
export async function getWallet(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('wallets')
    .select('id, balance_kobo, status, currency, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new WalletError(`Failed to read wallet: ${error.message}`);
  return data || { id: null, balance_kobo: 0, status: 'active', currency: 'NGN' };
}

// Paginated ledger for a user's wallet.
export async function getWalletLedger(userId, { page = 1, limit = 20 } = {}) {
  const supabase = getSupabaseAdmin();
  const wallet = await getWallet(userId);
  if (!wallet.id) return { entries: [], total: 0, page, limit };

  const from = (page - 1) * limit;
  const { data, error, count } = await supabase
    .from('wallet_ledger')
    .select('id, direction, amount_kobo, balance_after, reason, reference, created_at, note', { count: 'exact' })
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw new WalletError(`Failed to read ledger: ${error.message}`);
  return { entries: data || [], total: count || 0, page, limit };
}

// The only path that increases a balance. Idempotent on `reference` via the RPC,
// so a replayed webhook maps to the same ledger row instead of double-crediting.
export async function creditWallet({ userId, amountKobo, reason, reference, transactionId = null, adminId = null, note = null }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('wallet_credit', {
    p_user_id: userId,
    p_amount_kobo: amountKobo,
    p_reason: reason,
    p_reference: reference,
    p_transaction_id: transactionId,
    p_admin_id: adminId,
    p_note: note
  });
  if (error) throw new WalletError(`wallet_credit failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    walletId: row?.out_wallet_id,
    ledgerId: row?.out_ledger_id,
    balanceAfter: row?.out_balance_after,
    alreadyDone: !!row?.out_already_done
  };
}

/**
 * Pay for a service from the wallet. Debits and fulfills atomically in one DB
 * transaction (pay_with_wallet RPC → process_payment_success), so money never
 * leaves the wallet without an order. Idempotent on the reference.
 */
export async function payWithWallet(params) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('pay_with_wallet', {
    p_user_id: params.userId,
    p_reference: params.reference,
    p_amount_kobo: params.amountKobo,
    p_transaction_id: params.transactionId,
    p_order_type: params.orderType,
    p_renewal_months: params.renewalMonths,
    p_selected_items: params.selectedItems,
    p_renewal_amount: params.renewalAmount,
    p_delivery_fee: params.deliveryFee,
    p_delivery_address: params.deliveryAddress ?? null,
    p_delivery_state: params.deliveryState ?? null,
    p_delivery_lga: params.deliveryLGA ?? null,
    p_delivery_contact: params.deliveryContact ?? null,
    p_metadata: params.metadata ?? {},
    p_renewal_state: params.renewalState ?? null
  });
  if (error) {
    if (/INSUFFICIENT_BALANCE/.test(error.message)) throw new WalletError('Insufficient wallet balance.', 400, 'INSUFFICIENT_BALANCE');
    if (/WALLET_FROZEN/.test(error.message)) throw new WalletError('Your wallet is frozen. Please contact support.', 403, 'WALLET_FROZEN');
    if (/WALLET_NOT_FOUND/.test(error.message)) throw new WalletError('No wallet found. Fund your wallet first.', 404, 'WALLET_NOT_FOUND');
    throw new WalletError(`pay_with_wallet failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    transactionId: row?.out_transaction_id,
    orderId: row?.out_order_id,
    alreadyProcessed: !!row?.out_already_processed,
    balanceAfter: row?.out_balance_after
  };
}

/**
 * Shared success handler for a Paystack wallet-funding charge. Called from both
 * the webhook and the verify path. Marks the transaction successful and credits
 * the wallet with the amount the user chose to land in it (stored at init in
 * metadata.wallet_credit_kobo) — NOT the gross charge (which includes the fee).
 *
 * Idempotent end to end: updateTransactionStatus no-ops on an already-final
 * transaction, and wallet_credit no-ops on a duplicate reference.
 */
export async function handleWalletFundingSuccess(transaction, gatewayData, metadata) {
  const creditKobo = Number(metadata?.wallet_credit_kobo);
  if (!Number.isInteger(creditKobo) || creditKobo <= 0) {
    logError('[Wallet Funding] Missing/invalid wallet_credit_kobo in metadata — cannot credit', {
      reference: transaction.reference,
      wallet_credit_kobo: metadata?.wallet_credit_kobo
    });
    await updateTransactionStatus(transaction.reference, { status: PAYMENT_STATUS.FAILED });
    return { credited: false };
  }

  // Mark successful. Tolerate the already-final case (409) so a webhook+verify
  // race — both firing for one funding — doesn't throw before the credit. The
  // credit below is idempotent on the reference regardless.
  try {
    await updateTransactionStatus(transaction.reference, {
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel: gatewayData?.channel,
      paid_at: gatewayData?.paid_at
    });
  } catch (err) {
    if (err?.statusCode !== 409) throw err;
  }

  const result = await creditWallet({
    userId: transaction.user_id,
    amountKobo: creditKobo,
    reason: 'funding',
    reference: transaction.reference,     // idempotency key = payment reference
    transactionId: transaction.id
  });

  if (result.alreadyDone) {
    logWarn('[Wallet Funding] Duplicate funding credit ignored (idempotent)', { reference: transaction.reference });
  } else {
    logInfo('[Wallet Funding] Wallet credited', {
      reference: transaction.reference,
      userId: transaction.user_id,
      creditKobo,
      balanceAfter: result.balanceAfter
    });
  }

  try {
    await logPaymentAudit({
      eventType: 'wallet_funding_success',
      transactionId: transaction.id,
      reference: transaction.reference,
      userId: transaction.user_id,
      paymentGateway: 'paystack',
      amountKobo: creditKobo,
      statusAfter: PAYMENT_STATUS.SUCCESSFUL,
      metadata: { wallet_credit_kobo: creditKobo, balance_after: result.balanceAfter }
    });
  } catch (auditErr) {
    logError('[Wallet Funding] audit log failed (non-fatal)', { error: auditErr.message });
  }

  return { credited: !result.alreadyDone, balanceAfter: result.balanceAfter };
}
