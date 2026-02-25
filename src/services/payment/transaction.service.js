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
  
  if (paymentGateway !== 'paystack' && paymentGateway !== 'monicredit') {
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
  paid_at
}) {
  if (!Object.values(PAYMENT_STATUS).includes(status)) {
    throw new TransactionError('Invalid transaction status', HTTP_STATUS.BAD_REQUEST);
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  
  const updateData = { status };
  
  if (channel) updateData.channel = channel;
  if (authorization_code) updateData.authorization_code = authorization_code;
  if (paid_at) updateData.paid_at = paid_at;
  
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
  metadata
}) {
  const supabaseAdmin = getSupabaseAdmin();

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
    p_metadata: metadata || null
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
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  
  const supabaseAdmin = getSupabaseAdmin();
  
  let query = supabaseAdmin
    .from('payment_transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);
  
  if (options.status) {
    query = query.eq('status', options.status);
  }
  
  if (options.paymentType) {
    query = query.eq('payment_type', options.paymentType);
  }
  
  const { data: transactions, count, error } = await query;
  
  if (error) {
    logError('Get user transactions error', { error, userId });
    throw new TransactionError('Failed to retrieve transactions', HTTP_STATUS.SERVER_ERROR);
  }
  
  const enrichedTransactions = await Promise.all(
    (transactions || []).map(async (tx) => {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number, status, selected_items')
        .eq('transaction_id', tx.id)
        .maybeSingle();
      
      let items = [];
      if (order && !orderError && order.selected_items) {
        const itemKeys = order.selected_items;
        
        if (itemKeys.length > 0) {
          const { data: renewalItems } = await supabaseAdmin
            .from('renewal_items')
            .select('item_key, name, price')
            .in('item_key', itemKeys);
          
          items = (renewalItems || []).map(item => ({
            name: item.name,
            price: item.price,
            quantity: 1
          }));
        }
      }
      
      return {
        ...tx,
        order: order || null,
        items: items
      };
    })
  );
  
  const totalTransactions = count || 0;
  const totalPages = Math.ceil(totalTransactions / limit);
  
  return {
    transactions: enrichedTransactions,
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

export async function markTransactionAbandoned(reference) {
  return updateTransactionStatus(reference, { status: PAYMENT_STATUS.ABANDONED });
}

export async function markTransactionRefunded(reference, refundData = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .update({
      status: PAYMENT_STATUS.REFUNDED,
      metadata: supabaseAdmin.sql`metadata || ${JSON.stringify({ refund: refundData })}`
    })
    .eq('reference', reference)
    .select('*')
    .single();
  
  if (error) {
    logError('Mark transaction refunded error', { error, reference });
    throw new TransactionError('Failed to update transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  return transaction;
}

