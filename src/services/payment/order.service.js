/**
 * ORDER SERVICE
 * 
 * Handles database operations for renewal orders.
 * Orders are created after successful payments for admin processing.
 */

import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import {
  ORDER_STATUS,
  ORDER_TYPE,
  HTTP_STATUS,
  ERROR_MESSAGES,
  PAGINATION
} from '../../constants/payment.constants.js';
import {
  generateOrderNumber,
  calculateNewExpiryDate,
  getTodayDateString
} from '../../utils/paymentHelpers.js';

/**
 * OrderError - Custom error class for order operations
 */
export class OrderError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = 'OrderError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Create a new renewal order
 * 
 * Called automatically after a successful payment webhook.
 * 
 * @param {Object} options - Order options
 * @param {string} options.userId - User UUID
 * @param {number} options.carId - Car ID
 * @param {number} options.transactionId - Payment transaction ID
 * @param {string} options.orderType - Order type enum
 * @param {number} options.amountPaid - Total amount paid in kobo
 * @param {number} [options.renewalMonths] - Renewal period in months
 * @param {number} [options.subscriptionId] - Subscription ID (for auto renewals)
 * @param {Array} [options.selectedItems] - Selected renewal items
 * @param {number} [options.renewalAmount] - Amount for renewal items only (before delivery)
 * @param {number} [options.deliveryFee] - Delivery fee in kobo
 * @param {string} [options.deliveryAddress] - Delivery address
 * @param {string} [options.deliveryState] - Delivery state code
 * @param {string} [options.deliveryLGA] - Delivery local government
 * @param {string} [options.deliveryContact] - Delivery contact phone
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {Promise<Object>} Created order
 */
export async function createOrder({
  userId,
  carId,
  transactionId,
  orderType,
  amountPaid,
  renewalMonths = 12,
  subscriptionId = null,
  selectedItems = [],
  renewalAmount = null,
  deliveryFee = 0,
  deliveryAddress = null,
  deliveryState = null,
  deliveryLGA = null,
  deliveryContact = null,
  metadata = {}
}) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Validate order type
  if (!Object.values(ORDER_TYPE).includes(orderType)) {
    throw new OrderError('Invalid order type', HTTP_STATUS.BAD_REQUEST, 'INVALID_TYPE');
  }
  
  // Get current car expiry date
  const { data: car, error: carError } = await supabaseAdmin
    .from('cars')
    .select('expiry_date')
    .eq('id', carId)
    .single();
  
  if (carError) {
    logError('Get car for order creation error', { error: carError, carId });
    throw new OrderError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  // Generate unique order number
  const orderNumber = generateOrderNumber();
  
  // Create order record
  const orderData = {
    order_number: orderNumber,
    user_id: userId,
    car_id: carId,
    transaction_id: transactionId,
    subscription_id: subscriptionId,
    order_type: orderType,
    status: ORDER_STATUS.PENDING,
    amount_paid: amountPaid,
    currency: 'NGN',
    renewal_months: renewalMonths,
    previous_expiry_date: car.expiry_date,
    selected_items: selectedItems,
    renewal_amount: renewalAmount || amountPaid,
    delivery_fee: deliveryFee,
    delivery_address: deliveryAddress,
    delivery_state: deliveryState,
    delivery_lga: deliveryLGA,
    delivery_contact: deliveryContact,
    metadata
  };
  
  const { data: order, error } = await supabaseAdmin
    .from('renewal_orders')
    .insert(orderData)
    .select('*')
    .single();
  
  if (error) {
    logError('Create order error', { error, userId, carId, transactionId });
    throw new OrderError('Failed to create order', HTTP_STATUS.SERVER_ERROR, 'DB_ERROR');
  }
  
  logInfo('[Order Service] Order created', {
    orderNumber: order.order_number,
    carId,
    amount: amountPaid
  });
  
  return order;
}

/**
 * Get order by ID
 * 
 * @param {number} orderId - Order ID
 * @returns {Promise<Object|null>} Order or null
 */
export async function getOrderById(orderId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: order, error } = await supabaseAdmin
    .from('renewal_orders')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date,
        status
      ),
      payment_transactions:transaction_id (
        id,
        reference,
        amount,
        status,
        paid_at
      )
    `)
    .eq('id', orderId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get order by ID error', { error, orderId });
    throw new OrderError('Failed to retrieve order', HTTP_STATUS.SERVER_ERROR);
  }
  
  return order || null;
}

/**
 * Get order by order number
 * 
 * @param {string} orderNumber - Order number
 * @returns {Promise<Object|null>} Order or null
 */
export async function getOrderByNumber(orderNumber) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: order, error } = await supabaseAdmin
    .from('renewal_orders')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date,
        status
      ),
      payment_transactions:transaction_id (
        id,
        reference,
        amount,
        status,
        paid_at
      )
    `)
    .eq('order_number', orderNumber)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get order by number error', { error, orderNumber });
    throw new OrderError('Failed to retrieve order', HTTP_STATUS.SERVER_ERROR);
  }
  
  return order || null;
}

/**
 * Get order by transaction ID
 *
 * @param {number} transactionId - Payment transaction ID
 * @returns {Promise<Object|null>} Order or null
 */
export async function getOrderByTransactionId(transactionId) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: order, error } = await supabaseAdmin
    .from('renewal_orders')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date,
        status
      ),
      payment_transactions:transaction_id (
        id,
        reference,
        amount,
        status,
        paid_at
      )
    `)
    .eq('transaction_id', transactionId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logError('Get order by transaction ID error', { error, transactionId });
    throw new OrderError('Failed to retrieve order', HTTP_STATUS.SERVER_ERROR);
  }

  return order || null;
}

/**
 * Get orders with pagination and filters (for admin)
 * 
 * @param {Object} options - Query options
 * @param {number} [options.page] - Page number
 * @param {number} [options.limit] - Items per page
 * @param {string} [options.status] - Filter by status
 * @param {string} [options.orderType] - Filter by order type
 * @param {string} [options.assignedTo] - Filter by assigned admin
 * @returns {Promise<Object>} { orders, pagination }
 */
export async function getOrders(options = {}) {
  const page = Math.max(PAGINATION.MIN_PAGE, options.page || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(PAGINATION.MIN_LIMIT, options.limit || PAGINATION.DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  
  const supabaseAdmin = getSupabaseAdmin();
  
  let query = supabaseAdmin
    .from('renewal_orders')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        name_of_owner
      ),
      payment_transactions:transaction_id (
        id,
        reference,
        amount,
        status
      ),
      profiles:user_id (
        id,
        user_id,
        first_name,
        last_name,
        email
      )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  
  // Apply filters
  if (options.status) {
    query = query.eq('status', options.status);
  }
  
  if (options.orderType) {
    query = query.eq('order_type', options.orderType);
  }
  
  if (options.assignedTo) {
    query = query.eq('assigned_to', options.assignedTo);
  }
  
  const { data: orders, count, error } = await query;
  
  if (error) {
    logError('Get orders error', { error, options });
    throw new OrderError('Failed to retrieve orders', HTTP_STATUS.SERVER_ERROR);
  }
  
  const totalOrders = count || 0;
  const totalPages = Math.ceil(totalOrders / limit);
  
  return {
    orders: orders || [],
    pagination: {
      current_page: page,
      limit,
      total_orders: totalOrders,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    }
  };
}

/**
 * Get user's orders
 * 
 * @param {string} userId - User UUID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} { orders, pagination }
 */
export async function getUserOrders(userId, options = {}) {
  const page = Math.max(PAGINATION.MIN_PAGE, options.page || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(PAGINATION.MIN_LIMIT, options.limit || PAGINATION.DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  
  const supabaseAdmin = getSupabaseAdmin();
  
  let query = supabaseAdmin
    .from('renewal_orders')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no
      )
    `, { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);
  
  if (options.status) {
    query = query.eq('status', options.status);
  }
  
  const { data: orders, count, error } = await query;
  
  if (error) {
    logError('Get user orders error', { error, userId });
    throw new OrderError('Failed to retrieve orders', HTTP_STATUS.SERVER_ERROR);
  }
  
  const totalOrders = count || 0;
  const totalPages = Math.ceil(totalOrders / limit);
  
  return {
    orders: orders || [],
    pagination: {
      current_page: page,
      limit,
      total_orders: totalOrders,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    }
  };
}

/**
 * Assign order to admin
 * 
 * @param {number} orderId - Order ID
 * @param {string} adminId - Admin user UUID
 * @returns {Promise<Object>} Updated order
 */
export async function assignOrder(orderId, adminId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Get current order
  const order = await getOrderById(orderId);
  if (!order) {
    throw new OrderError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (order.status !== ORDER_STATUS.PENDING) {
    throw new OrderError(ERROR_MESSAGES.ORDER_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('renewal_orders')
    .update({
      assigned_to: adminId,
      assigned_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .select('*')
    .single();
  
  if (error) {
    logError('Assign order error', { error, orderId, adminId });
    throw new OrderError('Failed to assign order', HTTP_STATUS.SERVER_ERROR);
  }
  
  logInfo('[Order Service] Order assigned', { orderId, adminId });
  
  return updated;
}

/**
 * Start processing an order
 * 
 * @param {number} orderId - Order ID
 * @param {string} adminId - Admin user UUID
 * @param {string} [notes] - Processing notes
 * @returns {Promise<Object>} Updated order
 */
export async function startProcessingOrder(orderId, adminId, notes = null) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Get current order
  const order = await getOrderById(orderId);
  if (!order) {
    throw new OrderError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (order.status === ORDER_STATUS.COMPLETED) {
    throw new OrderError(ERROR_MESSAGES.ORDER_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
  }
  
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new OrderError(ERROR_MESSAGES.ORDER_CANCELLED, HTTP_STATUS.CONFLICT);
  }
  
  const updateData = {
    status: ORDER_STATUS.PROCESSING,
    processing_started_at: new Date().toISOString()
  };
  
  // Auto-assign if not already assigned
  if (!order.assigned_to) {
    updateData.assigned_to = adminId;
    updateData.assigned_at = new Date().toISOString();
  }
  
  if (notes) {
    updateData.processing_notes = notes;
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('renewal_orders')
    .update(updateData)
    .eq('id', orderId)
    .select('*')
    .single();
  
  if (error) {
    logError('Start processing order error', { error, orderId });
    throw new OrderError('Failed to update order', HTTP_STATUS.SERVER_ERROR);
  }
  
  logInfo('[Order Service] Order processing started', { orderId });
  
  return updated;
}

/**
 * Complete an order and extend car expiry
 * 
 * @param {number} orderId - Order ID
 * @param {string} adminId - Admin user UUID
 * @param {Object} options - Completion options
 * @param {string} [options.notes] - Completion notes
 * @param {number} [options.renewalMonths] - Override renewal months
 * @returns {Promise<Object>} { order, car } Updated order and car
 */
export async function completeOrder(orderId, adminId, options = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Get current order with car data
  const order = await getOrderById(orderId);
  if (!order) {
    throw new OrderError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (order.status === ORDER_STATUS.COMPLETED) {
    throw new OrderError(ERROR_MESSAGES.ORDER_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
  }
  
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new OrderError(ERROR_MESSAGES.ORDER_CANCELLED, HTTP_STATUS.CONFLICT);
  }
  
  // Calculate new expiry date
  const renewalMonths = options.renewalMonths || order.renewal_months || 12;
  const newExpiryDate = calculateNewExpiryDate(order.cars?.expiry_date, renewalMonths);
  const newDateIssued = getTodayDateString();
  
  // Update car expiry and status
  const { data: updatedCar, error: carError } = await supabaseAdmin
    .from('cars')
    .update({
      expiry_date: newExpiryDate,
      date_issued: newDateIssued,
      status: 'approved'  // Car status → approved after renewal
    })
    .eq('id', order.car_id)
    .select('*')
    .single();
  
  if (carError) {
    logError('Update car on order completion error', { error: carError, orderId, carId: order.car_id });
    throw new OrderError('Failed to update car expiry', HTTP_STATUS.SERVER_ERROR);
  }
  
  // Update order status
  const orderUpdateData = {
    status: ORDER_STATUS.COMPLETED,
    new_expiry_date: newExpiryDate,
    completed_at: new Date().toISOString(),
    completion_notes: options.notes || null
  };
  
  // Set assigned_to if not already set
  if (!order.assigned_to) {
    orderUpdateData.assigned_to = adminId;
    orderUpdateData.assigned_at = new Date().toISOString();
  }
  
  const { data: updatedOrder, error: orderError } = await supabaseAdmin
    .from('renewal_orders')
    .update(orderUpdateData)
    .eq('id', orderId)
    .select('*')
    .single();
  
  if (orderError) {
    logError('Complete order error', { error: orderError, orderId });
    throw new OrderError('Failed to complete order', HTTP_STATUS.SERVER_ERROR);
  }
  
  logInfo('[Order Service] Order completed', {
    orderId,
    carId: order.car_id,
    newExpiryDate
  });
  
  return {
    order: updatedOrder,
    car: updatedCar
  };
}

/**
 * Cancel an order
 * 
 * @param {number} orderId - Order ID
 * @param {string} adminId - Admin user UUID
 * @param {string} reason - Cancellation reason
 * @returns {Promise<Object>} Updated order
 */
export async function cancelOrder(orderId, adminId, reason) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Get current order
  const order = await getOrderById(orderId);
  if (!order) {
    throw new OrderError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (order.status === ORDER_STATUS.COMPLETED) {
    throw new OrderError('Cannot cancel a completed order', HTTP_STATUS.CONFLICT);
  }
  
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new OrderError(ERROR_MESSAGES.ORDER_CANCELLED, HTTP_STATUS.CONFLICT);
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('renewal_orders')
    .update({
      status: ORDER_STATUS.CANCELLED,
      rejection_reason: reason,
      cancelled_at: new Date().toISOString(),
      assigned_to: order.assigned_to || adminId
    })
    .eq('id', orderId)
    .select('*')
    .single();
  
  if (error) {
    logError('Cancel order error', { error, orderId });
    throw new OrderError('Failed to cancel order', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Order Service] Order cancelled:', { orderId, reason });
  
  return updated;
}

/**
 * Get order statistics (for admin dashboard)
 * 
 * @returns {Promise<Object>} Order statistics
 */
export async function getOrderStats() {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Get counts by status
  const { data: statusCounts, error } = await supabaseAdmin
    .from('renewal_orders')
    .select('status')
    .then(async (result) => {
      if (result.error) throw result.error;
      
      const counts = {
        pending: 0,
        processing: 0,
        completed: 0,
        cancelled: 0,
        total: result.data?.length || 0
      };
      
      result.data?.forEach(order => {
        if (counts.hasOwnProperty(order.status)) {
          counts[order.status]++;
        }
      });
      
      return counts;
    });
  
  if (error) {
    logError('Get order stats error', { error });
    throw new OrderError('Failed to retrieve order statistics', HTTP_STATUS.SERVER_ERROR);
  }
  
  // Get today's orders count
  const today = getTodayDateString();
  const { count: todayCount } = await supabaseAdmin
    .from('renewal_orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00Z`)
    .lte('created_at', `${today}T23:59:59Z`);
  
  return {
    ...statusCounts,
    today: todayCount || 0
  };
}

/**
 * Check if a car has a pending order
 * 
 * @param {number} carId - Car ID
 * @returns {Promise<boolean>} True if pending order exists
 */
export async function hasPendingOrder(carId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data, error } = await supabaseAdmin
    .from('renewal_orders')
    .select('id')
    .eq('car_id', carId)
    .in('status', [ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING])
    .limit(1);
  
  if (error) {
    logError('Check pending order error', { error, carId });
    return false;
  }
  
  return data && data.length > 0;
}

/**
 * Update order status
 * 
 * @param {number} orderId - Order ID
 * @param {string} status - New status
 * @param {string} adminId - Admin user UUID
 * @param {string} [notes] - Status update notes
 * @returns {Promise<Object>} Updated order
 */
export async function updateOrderStatus(orderId, status, adminId, notes = null) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Validate status
  if (!Object.values(ORDER_STATUS).includes(status)) {
    throw new OrderError('Invalid order status', HTTP_STATUS.BAD_REQUEST);
  }
  
  // Get current order
  const order = await getOrderById(orderId);
  if (!order) {
    throw new OrderError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (order.status === ORDER_STATUS.COMPLETED) {
    throw new OrderError(ERROR_MESSAGES.ORDER_ALREADY_PROCESSED, HTTP_STATUS.CONFLICT);
  }
  
  const updateData = {
    status,
    updated_at: new Date().toISOString()
  };
  
  // Add status-specific timestamps
  if (status === ORDER_STATUS.PROCESSING) {
    updateData.processing_started_at = new Date().toISOString();
  } else if (status === ORDER_STATUS.COMPLETED) {
    updateData.completed_at = new Date().toISOString();
  } else if (status === ORDER_STATUS.CANCELLED) {
    updateData.cancelled_at = new Date().toISOString();
    updateData.rejection_reason = notes;
  }
  
  // Auto-assign if not already assigned
  if (!order.assigned_to) {
    updateData.assigned_to = adminId;
    updateData.assigned_at = new Date().toISOString();
  }
  
  if (notes && status !== ORDER_STATUS.CANCELLED) {
    updateData.processing_notes = notes;
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('renewal_orders')
    .update(updateData)
    .eq('id', orderId)
    .select('*')
    .single();
  
  if (error) {
    logError('Update order status error', { error, orderId, status });
    throw new OrderError('Failed to update order status', HTTP_STATUS.SERVER_ERROR);
  }
  
  logInfo('[Order Service] Order status updated', { orderId, status });
  
  return updated;
}
