import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo, logWarn } from '../../utils/logger.js';
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  HTTP_STATUS,
  ERROR_MESSAGES,
  PAGINATION
} from '../../constants/payment.constants.js';
import {
  generatePaymentReference,
  validatePaymentAmount,
  formatAmount
} from '../../utils/paymentHelpers.js';
import { logPaymentAudit } from './audit.service.js';

export class TransactionError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = 'TransactionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Safe reference pattern for preventing SQL injection in .or() queries
const SAFE_REF_PATTERN = /^[A-Za-z0-9_\-]+$/;
function assertSafeReference(ref, label = 'reference') {
  if (!ref || !SAFE_REF_PATTERN.test(ref)) {
    throw new TransactionError(`Invalid ${label} format`, HTTP_STATUS.BAD_REQUEST, 'INVALID_REFERENCE');
  }
}

export async function createTransaction({
  userId,
  carId,
  amount,
  paymentType,
  metadata = {},
  reference,
  paymentGateway = 'monicredit'
}) {
  const amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    throw new TransactionError(amountValidation.error, HTTP_STATUS.BAD_REQUEST, 'INVALID_AMOUNT');
  }
  
  if (!Object.values(PAYMENT_TYPE).includes(paymentType)) {
    throw new TransactionError('Invalid payment type', HTTP_STATUS.BAD_REQUEST, 'INVALID_TYPE');
  }
  
  if (paymentGateway !== 'paystack' && paymentGateway !== 'monicredit' && paymentGateway !== 'wallet') {
    throw new TransactionError('Invalid payment gateway', HTTP_STATUS.BAD_REQUEST, 'INVALID_GATEWAY');
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  const transactionReference = reference || generatePaymentReference();
  
  const transactionData = {
    reference: transactionReference,
    user_id: userId,
    car_id: carId,
    amount,
    currency: 'NGN',
    payment_type: paymentType,
    payment_gateway: paymentGateway,
    status: PAYMENT_STATUS.PENDING,
    metadata
  };
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .insert(transactionData)
    .select('*')
    .single();
  
  if (error) {
    logError('Create transaction error', { error, userId, carId });
    // Handle unique constraint violation (23505) for duplicate reference
    if (error.code === '23505') {
      throw new TransactionError(ERROR_MESSAGES.DUPLICATE_REFERENCE, HTTP_STATUS.CONFLICT, 'DUPLICATE');
    }
    throw new TransactionError('Failed to create transaction', HTTP_STATUS.SERVER_ERROR, 'DB_ERROR');
  }
  
  logInfo('[Transaction Service] Transaction created', {
    id: transaction.id,
    reference: transaction.reference,
    gateway: paymentGateway,
    amount: formatAmount(amount)
  });
  
  return transaction;
}

export async function getTransactionByReference(reference) {
  if (!reference) {
    throw new TransactionError('Reference is required', HTTP_STATUS.BAD_REQUEST);
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transactions, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('reference', reference)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error && error.code !== 'PGRST116') {
    logError('Get transaction error', { error, reference });
    throw new TransactionError('Failed to retrieve transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  const transaction = transactions && transactions.length > 0 ? transactions[0] : null;
  
  if (transactions && transactions.length > 1) {
    logWarn('[Transaction Service] Multiple transactions found for reference', {
      reference,
      count: transactions.length,
      usingMostRecent: transaction?.id,
      allIds: transactions.map(tx => tx.id)
    });
  }
  
  return transaction;
}

export async function getTransactionByPaystackReference(paystackReference) {
  if (!paystackReference) {
    return null;
  }
  
  // Validate reference format to prevent SQL injection in .or() interpolation
  assertSafeReference(paystackReference, 'paystack reference');
  
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transactions, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .or(`reference.eq.${paystackReference},paystack_reference.eq.${paystackReference}`)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error && error.code !== 'PGRST116') {
    logError('Get transaction by Paystack reference error', { error, paystackReference });
  }
  
  const transaction = transactions && transactions.length > 0 ? transactions[0] : null;
  
  if (transactions && transactions.length > 1) {
    logWarn('[Transaction Service] Multiple transactions found for Paystack reference', {
      paystackReference,
      count: transactions.length,
      usingMostRecent: transaction?.id
    });
  }
  
  return transaction;
}

export async function getTransactionByWebhookEventId(eventId) {
  if (!eventId) {
    return null;
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('webhook_event_id', eventId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get transaction by webhook event ID error', { error, eventId });
  }
  
  return transaction || null;
}

export async function updateTransactionWebhookEventId(reference, eventId) {
  if (!reference || !eventId) {
    throw new TransactionError('Reference and event ID are required', HTTP_STATUS.BAD_REQUEST);
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  
  const { error } = await supabaseAdmin
    .from('payment_transactions')
    .update({ 
      webhook_event_id: eventId,
      webhook_processed_at: new Date().toISOString()
    })
    .eq('reference', reference);
  
  if (error) {
    logError('Update webhook event ID error', { error, reference, eventId });
    // Preserve the original error code for unique constraint violations
    const errorCode = error.code || (error.error && error.error.code);
    throw new TransactionError('Failed to update webhook event ID', HTTP_STATUS.SERVER_ERROR, errorCode);
  }
}

export async function getTransactionById(transactionId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('id', transactionId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get transaction by ID error', { error, transactionId });
    throw new TransactionError('Failed to retrieve transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  return transaction || null;
}

export async function updateTransactionWithPaystackInit(reference, paystackData) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .update({
      paystack_reference: paystackData.reference,
      paystack_access_code: paystackData.access_code,
      payment_gateway: 'paystack'
    })
    .eq('reference', reference)
    .select('*')
    .single();
  
  if (error) {
    logError('Update transaction with Paystack init error', { error, reference });
    throw new TransactionError('Failed to update transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  return transaction;
}

export async function updateTransactionWithMonicreditInit(reference, monicreditData) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .update({
      monicredit_order_id: monicreditData.order_id,
      monicredit_transaction_id: monicreditData.transaction_id,
      monicredit_account_number: monicreditData.account_number,
      monicredit_bank_name: monicreditData.bank_name,
      monicredit_account_name: monicreditData.account_name,
      payment_gateway: 'monicredit'
    })
    .eq('reference', reference)
    .select('*')
    .single();
  
  if (error) {
    logError('Update transaction with Monicredit init error', { error, reference });
    throw new TransactionError('Failed to update transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  return transaction;
}

export async function getTransactionByMonicreditOrderId(orderId) {
  if (!orderId) {
    return null;
  }
  
  // Validate order ID format to prevent SQL injection in .or() interpolation
  assertSafeReference(orderId, 'order ID');
  
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transactions, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .or(`reference.eq.${orderId},monicredit_order_id.eq.${orderId}`)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error && error.code !== 'PGRST116') {
    logError('Get transaction by Monicredit order ID error', { error, orderId });
  }
  
  const transaction = transactions && transactions.length > 0 ? transactions[0] : null;
  
  if (transactions && transactions.length > 1) {
    logWarn('[Transaction Service] Multiple transactions found for Monicredit order ID', {
      orderId,
      count: transactions.length,
      usingMostRecent: transaction?.id
    });
  }
  
  return transaction;
}

export async function updateTransactionStatus(reference, {
  status,
  channel,
  authorization_code,
  paid_at,
  cancellation_reason
}) {
  if (!Object.values(PAYMENT_STATUS).includes(status)) {
    throw new TransactionError('Invalid transaction status', HTTP_STATUS.BAD_REQUEST);
  }

  const supabaseAdmin = getSupabaseAdmin();

  const updateData = { status };

  if (channel) updateData.channel = channel;
  if (authorization_code) updateData.authorization_code = authorization_code;
  if (paid_at) updateData.paid_at = paid_at;
  // cancellation_reason populates the column added in migration 064. Caller is
  // expected to pass one of: duplicate_init | gateway_failure | user_abandoned
  // | manual_cleanup. NULL is allowed (preserves legacy behavior for the
  // success path where no reason makes sense).
  if (cancellation_reason !== undefined && cancellation_reason !== null) {
    updateData.cancellation_reason = String(cancellation_reason).slice(0, 255);
  }
  
  // Atomic conditional UPDATE: prevent updating already-successful transactions
  // This replaces the read-check-write pattern with a single atomic operation
  const { data: updated, error } = await supabaseAdmin
    .from('payment_transactions')
    .update(updateData)
    .eq('reference', reference)
    .neq('status', PAYMENT_STATUS.SUCCESSFUL)  // Guard at DB level
    .select('*')
    .single();
  
  if (error) {
    // Check if the update failed because transaction doesn't exist or is already successful
    const { data: current } = await supabaseAdmin
      .from('payment_transactions')
      .select('status')
      .eq('reference', reference)
      .single();
    
    if (!current) {
      throw new TransactionError(ERROR_MESSAGES.PAYMENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    
    if (current.status === PAYMENT_STATUS.SUCCESSFUL) {
      throw new TransactionError(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
    }
    
    logError('Update transaction status error', { error, reference, status });
    throw new TransactionError('Failed to update transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  if (!updated) {
    // Update was blocked by the .neq() condition - transaction is already successful
    const { data: current } = await supabaseAdmin
      .from('payment_transactions')
      .select('*')
      .eq('reference', reference)
      .single();
    
    if (!current) {
      throw new TransactionError(ERROR_MESSAGES.PAYMENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    
    if (current.status === PAYMENT_STATUS.SUCCESSFUL) {
      throw new TransactionError(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
    }
    
    // If status matches, return existing transaction
    if (current.status === status) {
      return current;
    }
    
    throw new TransactionError('Unexpected update failure', HTTP_STATUS.SERVER_ERROR);
  }
  
  return updated;
}

/**
 * How long after a fulfilled payment a second successful charge for the same
 * vehicle is treated as an accidental duplicate rather than a real repeat purchase.
 *
 * Observed duplicates land within ~90 seconds (user with several checkout tabs
 * open, or switching gateway mid-flow). A genuine re-renewal of the same vehicle
 * is months apart, so a day of cover is generous without catching real purchases.
 */
const DUPLICATE_CHARGE_WINDOW_MS = Number(process.env.DUPLICATE_CHARGE_WINDOW_MS) || 24 * 60 * 60 * 1000;

/**
 * Detect a second successful charge for a vehicle that has ALREADY been fulfilled.
 *
 * The init-time guard only abandons *pending* rows, and the RPC's uniqueness is per
 * transaction (`renewal_orders_transaction_unique`), so N distinct references for
 * one car each pass both checks. On 2026-05-14 one customer was charged 3× ₦5,000
 * in 90 seconds across two gateways for a single ₦5,000 renewal.
 *
 * Returns { fulfilled, siblingCount } — `fulfilled` is the order that already
 * covered this vehicle, or null. Deliberately conservative: if the earlier payment
 * never produced an order, this one is allowed through, because it may be the only
 * fulfilment the customer gets. `siblingCount` lets the caller flag that case for
 * review rather than losing it.
 */
async function findAlreadyFulfilledOrder(supabaseAdmin, tx) {
  const none = { fulfilled: null, siblingCount: 0 };
  if (!tx?.car_id || !tx?.user_id) return none;

  const since = new Date(Date.now() - DUPLICATE_CHARGE_WINDOW_MS).toISOString();

  const { data: earlier } = await supabaseAdmin
    .from('payment_transactions')
    .select('id, reference, created_at')
    .eq('user_id', tx.user_id)
    .eq('car_id', tx.car_id)
    .eq('payment_type', tx.payment_type)
    .eq('status', PAYMENT_STATUS.SUCCESSFUL)
    .neq('reference', tx.reference)
    .gte('created_at', since);

  if (!earlier?.length) return none;

  // Only a charge whose sibling actually produced an order is a duplicate. Without
  // this, a retry after a genuinely failed fulfilment would be silently swallowed.
  const { data: order } = await supabaseAdmin
    .from('renewal_orders')
    .select('id, order_number')
    .in('transaction_id', earlier.map(t => t.id))
    .limit(1)
    .maybeSingle();

  return { fulfilled: order || null, siblingCount: earlier.length };
}

export async function processPaymentSuccess({
  reference,
  status,
  channel,
  authorization_code,
  paid_at,
  orderType,
  renewalMonths,
  selectedItems,
  renewalAmount,
  deliveryFee,
  deliveryAddress,
  deliveryState,
  deliveryLGA,
  deliveryContact,
  metadata,
  renewalState = null
}) {
  const supabaseAdmin = getSupabaseAdmin();

  // ── Duplicate-charge guard ──────────────────────────────────────────────────
  // The money has already left the customer's account, so this never rejects the
  // payment — recording it is what makes a refund possible. What it prevents is a
  // SECOND order being created and the expiry being extended twice for one renewal.
  if (status === PAYMENT_STATUS.SUCCESSFUL) {
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, reference, user_id, car_id, payment_type, amount, status')
      .eq('reference', reference)
      .maybeSingle();

    if (tx && tx.status !== PAYMENT_STATUS.SUCCESSFUL) {
      const { fulfilled, siblingCount } = await findAlreadyFulfilledOrder(supabaseAdmin, tx);

      // A burst that produced no order yet is still allowed through — it may be the
      // customer's only fulfilment — but it must not pass silently, because one of
      // the burst will end up an orphan charge nobody refunds.
      if (!fulfilled && siblingCount > 0) {
        logWarn('[Payment] Multiple successful charges for one vehicle — REVIEW', {
          reference,
          userId: tx.user_id,
          carId: tx.car_id,
          otherSuccessfulCharges: siblingCount,
          note: 'Allowed through: no order exists yet for this vehicle.',
        });
      }

      if (fulfilled) {
        // Mark it received and tag it, rather than running the order-creating RPC.
        await supabaseAdmin
          .from('payment_transactions')
          .update({
            status: PAYMENT_STATUS.SUCCESSFUL,
            channel: channel || null,
            authorization_code: authorization_code || null,
            paid_at: paid_at || new Date().toISOString(),
            cancellation_reason: 'duplicate_charge',
            updated_at: new Date().toISOString()
          })
          .eq('reference', reference);

        logWarn('[Payment] Duplicate charge detected — REFUND REQUIRED', {
          reference,
          userId: tx.user_id,
          carId: tx.car_id,
          amount_naira: Number(tx.amount || 0) / 100,
          alreadyFulfilledBy: fulfilled.order_number,
        });

        return {
          transactionId: tx.id,
          orderId: null,
          alreadyProcessed: true,
          duplicateCharge: true,
          refundDue: true,
          fulfilledByOrder: fulfilled.order_number,
        };
      }
    }
  }

  const { data, error } = await supabaseAdmin.rpc('process_payment_success', {
    p_reference: reference,
    p_status: status,
    p_channel: channel || null,
    p_authorization_code: authorization_code || null,
    p_paid_at: paid_at || null,
    p_order_type: orderType,
    p_renewal_months: renewalMonths || null,
    p_selected_items: selectedItems || null,
    p_renewal_amount: renewalAmount || null,
    p_delivery_fee: deliveryFee || null,
    p_delivery_address: deliveryAddress || null,
    p_delivery_state: deliveryState || null,
    p_delivery_lga: deliveryLGA || null,
    p_delivery_contact: deliveryContact || null,
    p_metadata: metadata || null,
    p_renewal_state: renewalState || null
  });

  if (error) {
    logError('Process payment success RPC error', {
      reference,
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    throw new TransactionError('Failed to process payment', HTTP_STATUS.SERVER_ERROR);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    transactionId: result?.transaction_id || null,
    orderId: result?.order_id || null,
    alreadyProcessed: !!result?.already_processed
  };
}

export async function getUserTransactions(userId, options = {}) {
  const page = Math.max(PAGINATION.MIN_PAGE, options.page || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(PAGINATION.MIN_LIMIT, options.limit || PAGINATION.DEFAULT_LIMIT));

  const supabaseAdmin = getSupabaseAdmin();

  // ── Fetch ALL normal transactions (no range — we paginate after merging) ──
  let txQuery = supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options.status) txQuery = txQuery.eq('status', options.status);
  if (options.paymentType) txQuery = txQuery.eq('payment_type', options.paymentType);

  const { data: transactions, error } = await txQuery;

  if (error) {
    logError('Get user transactions error', { error, userId });
    throw new TransactionError('Failed to retrieve transactions', HTTP_STATUS.SERVER_ERROR);
  }
  // ── Enrich normal authenticated transactions with their renewal orders ──
  const txIds = (transactions || []).map(tx => tx.id);
  const { data: allOrders } = txIds.length > 0
    ? await supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number, status, selected_items, transaction_id')
        .in('transaction_id', txIds)
    : { data: [] };

  // Collect all unique item keys across all orders, then fetch names in one query
  const allItemKeys = [...new Set(
    (allOrders || []).flatMap(o => o.selected_items || [])
  )];
  const { data: allRenewalItems } = allItemKeys.length > 0
    ? await supabaseAdmin
        .from('renewal_items')
        .select('item_key, name, price')
        .in('item_key', allItemKeys)
    : { data: [] };

  const itemByKey = Object.fromEntries((allRenewalItems || []).map(i => [i.item_key, i]));
  const orderByTxId = Object.fromEntries((allOrders || []).map(o => [o.transaction_id, o]));

  const enrichedTransactions = (transactions || []).map(tx => {
    const order = orderByTxId[tx.id] || null;
    const items = order?.selected_items?.length > 0
      ? order.selected_items
          .map(key => itemByKey[key])
          .filter(Boolean)
          .map(item => ({ name: item.name, price: item.price, quantity: 1 }))
      : [];
    return {
      source: 'normal',
      ...tx,
      order: order || null,
      items
    };
  });

  // ── Guest renewals linked to this user (upgraded from guest flow) ─────────
  const { data: guestOrders, error: guestError } = await supabaseAdmin
    .from('guest_renewal_orders')
    .select('id, payment_reference, total_amount, payment_status, payment_gateway, plate_number, created_at, selected_items, receipt_token')
    .eq('linked_user_id', userId)
    .eq('payment_status', 'payment_success')
    .order('created_at', { ascending: false });

  if (guestError) {
    logError('Get guest renewal transactions error', { error: guestError, userId });
  }

  const guestItemKeys = [...new Set(
    (guestOrders || []).flatMap(o => o.selected_items || [])
  )];
  const { data: guestRenewalItems } = guestItemKeys.length > 0
    ? await supabaseAdmin
        .from('renewal_items')
        .select('item_key, name, price')
        .in('item_key', guestItemKeys)
    : { data: [] };

  const guestItemByKey = Object.fromEntries((guestRenewalItems || []).map(i => [i.item_key, i]));

  const guestTransactions = (guestOrders || []).map(order => {
    const items = order.selected_items?.length > 0
      ? order.selected_items
          .map(key => guestItemByKey[key])
          .filter(Boolean)
          .map(item => ({ name: item.name, price: item.price, quantity: 1 }))
      : [];
    return {
      source: 'guest',
      id: `guest-${order.id}`,
      reference: order.payment_reference || order.id,
      user_id: userId,
      car_id: order.car_id || null,
      amount: order.total_amount,
      currency: 'NGN',
      payment_type: 'guest_renewal',
      payment_gateway: order.payment_gateway,
      status: order.payment_status === 'payment_success'
        ? PAYMENT_STATUS.SUCCESSFUL
        : PAYMENT_STATUS.FAILED,
      created_at: order.created_at,
      order: {
        id: order.id,
        order_number: order.payment_reference || order.id,
        status: order.payment_status,
        selected_items: order.selected_items
      },
      items,
      receipt_token: order.receipt_token
    };
  });

  // ── Merge both lists, sort by date, then paginate the combined result ──────
  // Fetching all transactions before slicing is intentional: typical users have
  // O(10s–100s) transactions, and merging two paginated lists by date would
  // require cursor-based pagination or a UNION query.
  const allCombined = [...enrichedTransactions, ...guestTransactions].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const totalTransactions = allCombined.length;
  const totalPages = Math.ceil(totalTransactions / limit);
  const from = (page - 1) * limit;
  const paginated = allCombined.slice(from, from + limit);

  return {
    transactions: paginated,
    pagination: {
      current_page: page,
      limit,
      total_transactions: totalTransactions,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    }
  };
}

export async function getCarTransactions(carId, options = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  
  let query = supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('car_id', carId)
    .order('created_at', { ascending: false });
  
  if (options.status) {
    query = query.eq('status', options.status);
  }
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  const { data: transactions, error } = await query;
  
  if (error) {
    logError('Get car transactions error', { error, carId });
    throw new TransactionError('Failed to retrieve transactions', HTTP_STATUS.SERVER_ERROR);
  }
  
  return transactions || [];
}

export async function hasSuccessfulPayment(carId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('car_id', carId)
    .eq('status', PAYMENT_STATUS.SUCCESSFUL)
    .limit(1);
  
  if (error) {
    logError('Check successful payment error', { error, carId });
    return false;
  }
  
  return data && data.length > 0;
}

export async function getLatestSuccessfulTransaction(carId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('car_id', carId)
    .eq('status', PAYMENT_STATUS.SUCCESSFUL)
    .order('paid_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get latest successful transaction error', { error, carId });
    return null;
  }
  
  return transaction || null;
}

export async function markTransactionAbandoned(reference, cancellation_reason = null) {
  return updateTransactionStatus(reference, {
    status: PAYMENT_STATUS.ABANDONED,
    cancellation_reason
  });
}

export async function markTransactionRefunded(reference, refundData = {}) {
  const supabaseAdmin = getSupabaseAdmin();

  const existing = await getTransactionByReference(reference);
  if (!existing) {
    throw new TransactionError(ERROR_MESSAGES.PAYMENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }

  let mergedMetadata = {};
  try {
    mergedMetadata = typeof existing.metadata === 'string'
      ? JSON.parse(existing.metadata)
      : (existing.metadata || {});
  } catch (e) {
    logWarn('Could not parse existing metadata for refund', { reference });
  }
  mergedMetadata.refund = { ...(mergedMetadata.refund || {}), ...refundData };

  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .update({
      status: PAYMENT_STATUS.REFUNDED,
      metadata: mergedMetadata,
      updated_at: new Date().toISOString()
    })
    .eq('reference', reference)
    .select('*')
    .single();

  if (error) {
    logError('Mark transaction refunded error', { error, reference });
    throw new TransactionError('Failed to update transaction', HTTP_STATUS.SERVER_ERROR);
  }

  await logPaymentAudit({
    eventType: 'refund',
    transactionId: transaction.id,
    reference,
    userId: transaction.user_id,
    paymentGateway: transaction.payment_gateway,
    amountKobo: transaction.amount,
    statusBefore: existing.status,
    statusAfter: PAYMENT_STATUS.REFUNDED,
    metadata: { refund: refundData },
  });

  return transaction;
}

