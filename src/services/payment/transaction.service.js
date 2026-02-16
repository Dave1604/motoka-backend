import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';
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

export async function createTransaction({
  userId,
  carId,
  amount,
  paymentType,
  metadata = {},
  reference
}) {
  const amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    throw new TransactionError(amountValidation.error, HTTP_STATUS.BAD_REQUEST, 'INVALID_AMOUNT');
  }
  
  if (!Object.values(PAYMENT_TYPE).includes(paymentType)) {
    throw new TransactionError('Invalid payment type', HTTP_STATUS.BAD_REQUEST, 'INVALID_TYPE');
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  const transactionReference = reference || generatePaymentReference();
  
  const { data: existing } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('reference', transactionReference)
    .single();
  
  if (existing) {
    throw new TransactionError(ERROR_MESSAGES.DUPLICATE_REFERENCE, HTTP_STATUS.CONFLICT, 'DUPLICATE');
  }
  
  const transactionData = {
    reference: transactionReference,
    user_id: userId,
    car_id: carId,
    amount,
    currency: 'NGN',
    payment_type: paymentType,
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
    throw new TransactionError('Failed to create transaction', HTTP_STATUS.SERVER_ERROR, 'DB_ERROR');
  }
  
  console.log('[Transaction Service] Transaction created:', {
    id: transaction.id,
    reference: transaction.reference,
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
    console.warn('[Transaction Service] Multiple transactions found for reference:', {
      reference,
      count: transactions.length,
      usingMostRecent: transaction?.id,
      allIds: transactions.map(tx => tx.id)
    });
  }
  
  return transaction;
}

/**
 * Get transaction by Paystack reference
 * 
 * @param {string} paystackReference - Paystack's reference
 * @returns {Promise<Object|null>} Transaction or null
 */
export async function getTransactionByPaystackReference(paystackReference) {
  if (!paystackReference) {
    return null;
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  
  // Try both reference fields (our reference or Paystack's)
  // Get the most recent one if multiple match (shouldn't happen, but just in case)
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
    console.warn('[Transaction Service] Multiple transactions found for Paystack reference:', {
      paystackReference,
      count: transactions.length,
      usingMostRecent: transaction?.id
    });
  }
  
  return transaction;
}

/**
 * Get transaction by webhook event ID
 * Used to prevent replay attacks by checking if a webhook event has already been processed
 * 
 * @param {string} eventId - Paystack webhook event ID
 * @returns {Promise<Object|null>} Transaction or null
 */
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

/**
 * Update transaction with webhook event ID
 * Stores the webhook event ID to prevent replay attacks
 * 
 * @param {string} reference - Transaction reference
 * @param {string} eventId - Paystack webhook event ID
 * @returns {Promise<void>}
 */
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
    throw new TransactionError('Failed to update webhook event ID', HTTP_STATUS.SERVER_ERROR);
  }
}

/**
 * Get transaction by ID
 * 
 * @param {number} transactionId - Transaction ID
 * @returns {Promise<Object|null>} Transaction or null
 */
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

/**
 * Update transaction with Paystack initialization data
 * 
 * @param {string} reference - Transaction reference
 * @param {Object} paystackData - Paystack response data
 * @returns {Promise<Object>} Updated transaction
 */
export async function updateTransactionWithPaystackInit(reference, paystackData) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .update({
      paystack_reference: paystackData.reference,
      paystack_access_code: paystackData.access_code
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

/**
 * Update transaction status after payment verification
 * 
 * @param {string} reference - Transaction reference
 * @param {Object} options - Update options
 * @param {string} options.status - New status
 * @param {string} [options.channel] - Payment channel
 * @param {string} [options.authorization_code] - Authorization code for recurring
 * @param {Date|string} [options.paid_at] - Payment timestamp
 * @returns {Promise<Object>} Updated transaction
 */
export async function updateTransactionStatus(reference, {
  status,
  channel,
  authorization_code,
  paid_at
}) {
  // Validate status
  if (!Object.values(PAYMENT_STATUS).includes(status)) {
    throw new TransactionError('Invalid transaction status', HTTP_STATUS.BAD_REQUEST);
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  
  // First, get the current transaction
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('payment_transactions')
    .select('*')
    .eq('reference', reference)
    .single();
  
  if (fetchError || !existing) {
    throw new TransactionError(ERROR_MESSAGES.PAYMENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  // Check if already processed (idempotency)
  if (existing.status === status) {
    console.log('[Transaction Service] Transaction already in status:', status);
    return existing;
  }
  
  // Prevent updating successful/refunded transactions
  if (existing.status === PAYMENT_STATUS.SUCCESSFUL && status !== PAYMENT_STATUS.REFUNDED) {
    throw new TransactionError(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
  }
  
  // Build update data
  const updateData = { status };
  
  if (channel) updateData.channel = channel;
  if (authorization_code) updateData.authorization_code = authorization_code;
  if (paid_at) updateData.paid_at = paid_at;
  
  const { data: transaction, error } = await supabaseAdmin
    .from('payment_transactions')
    .update(updateData)
    .eq('reference', reference)
    .select('*')
    .single();
  
  if (error) {
    logError('Update transaction status error', { error, reference, status });
    throw new TransactionError('Failed to update transaction', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Transaction Service] Transaction status updated:', {
    reference,
    oldStatus: existing.status,
    newStatus: status
  });
  
  return transaction;
}

/**
 * Atomically mark payment successful and create order if missing
 *
 * @param {Object} options - Success processing options
 * @param {string} options.reference - Transaction reference
 * @param {string} options.status - New status (successful)
 * @param {string} [options.channel] - Payment channel
 * @param {string} [options.authorization_code] - Authorization code for recurring
 * @param {Date|string} [options.paid_at] - Payment timestamp
 * @param {string} options.orderType - Order type enum
 * @param {number} [options.renewalMonths] - Renewal period in months
 * @param {Array} [options.selectedItems] - Selected renewal items
 * @param {number} [options.renewalAmount] - Amount for renewal items only
 * @param {number} [options.deliveryFee] - Delivery fee in kobo
 * @param {string} [options.deliveryAddress] - Delivery address
 * @param {string} [options.deliveryState] - Delivery state code
 * @param {string} [options.deliveryLGA] - Delivery local government
 * @param {string} [options.deliveryContact] - Delivery contact phone
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {Promise<Object>} { transactionId, orderId, alreadyProcessed }
 */
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
    logError('Process payment success RPC error', { error, reference });
    throw new TransactionError('Failed to process payment', HTTP_STATUS.SERVER_ERROR);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    transactionId: result?.transaction_id || null,
    orderId: result?.order_id || null,
    alreadyProcessed: !!result?.already_processed
  };
}

/**
 * Get user's payment transactions with pagination
 * 
 * @param {string} userId - User UUID
 * @param {Object} options - Query options
 * @param {number} [options.page] - Page number
 * @param {number} [options.limit] - Items per page
 * @param {string} [options.status] - Filter by status
 * @param {string} [options.paymentType] - Filter by payment type
 * @returns {Promise<Object>} { transactions, pagination }
 */
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
  
  // Apply filters
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
  
  // Fetch orders and items for each transaction
  const enrichedTransactions = await Promise.all(
    (transactions || []).map(async (tx) => {
      // Use maybeSingle() instead of single() to handle missing orders gracefully
      const { data: order, error: orderError } = await supabaseAdmin
        .from('renewal_orders')
        .select('id, order_number, status, selected_items')
        .eq('transaction_id', tx.id)
        .maybeSingle();
      
      let items = [];
      if (order && !orderError && order.selected_items) {
        // selected_items is a JSONB array like ["vehicle_licence", "insurance"]
        // We need to fetch the names and prices from renewal_items table
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

/**
 * Get transactions for a specific car
 * 
 * @param {number} carId - Car ID
 * @param {Object} options - Query options
 * @returns {Promise<Object[]>} Transactions
 */
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

/**
 * Check if a car has a successful payment (for validation)
 * 
 * @param {number} carId - Car ID
 * @returns {Promise<boolean>} True if successful payment exists
 */
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

/**
 * Get the latest successful transaction for a car
 * 
 * @param {number} carId - Car ID
 * @returns {Promise<Object|null>} Transaction or null
 */
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

/**
 * Mark transaction as abandoned (for cleanup)
 * 
 * @param {string} reference - Transaction reference
 * @returns {Promise<Object>} Updated transaction
 */
export async function markTransactionAbandoned(reference) {
  return updateTransactionStatus(reference, { status: PAYMENT_STATUS.ABANDONED });
}

/**
 * Mark transaction as refunded
 * 
 * @param {string} reference - Transaction reference
 * @param {Object} [refundData] - Refund metadata
 * @returns {Promise<Object>} Updated transaction
 */
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

