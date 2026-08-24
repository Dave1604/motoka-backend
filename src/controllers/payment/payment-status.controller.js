import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';
import { paymentResponse } from './payment-response.util.js';
import {
  getUserTransactions,
  getCarTransactions,
  TransactionError
} from '../../services/payment/transaction.service.js';
import {
  getOrderByNumber,
  getOrderByTransactionId
} from '../../services/payment/order.service.js';
import {
  PAYMENT_STATUS,
  ERROR_MESSAGES,
  HTTP_STATUS
} from '../../constants/payment.constants.js';

// GET /api/payments/history
export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, status } = req.query;
    
    const result = await getUserTransactions(userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || undefined
    });
    
    return paymentResponse.success(res, result, 'Payment history retrieved');
  } catch (error) {
    logError('Get payment history error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve payment history');
  }
};

// POST /api/payment/check-existing
export const checkExistingPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { car_slug, payment_schedule_ids = [] } = req.body;
    
    if (!car_slug) {
      return paymentResponse.error(res, 'car_slug is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    if (!Array.isArray(payment_schedule_ids)) {
      return paymentResponse.error(res, 'payment_schedule_ids must be an array', HTTP_STATUS.BAD_REQUEST);
    }
    
    if (payment_schedule_ids.length === 0) {
      return paymentResponse.success(res, { existing_payments: [] }, 'No payment schedules to check');
    }
    
    const supabaseAdmin = getSupabaseAdmin();
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('id')
      .eq('slug', car_slug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();
    
    if (carError || !car) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
    }
    
    // Only flag as "already paid" when there is BOTH a successful transaction AND
    // a corresponding renewal order — guards against ghost transactions from payment bugs
    const { data: transactions, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .select('*, renewal_orders!inner(id, status)')
      .eq('car_id', car.id)
      .eq('user_id', userId)
      .eq('status', PAYMENT_STATUS.SUCCESSFUL)
      .not('renewal_orders.status', 'eq', 'cancelled');
    
    if (txError) {
      logError('Check existing payments DB error', txError);
      return paymentResponse.serverError(res, 'Failed to check existing payments');
    }
    
    // Convert snake_case schedule IDs to readable names (e.g. vehicle_licence → Vehicle Licence)
    const formatScheduleName = (id) =>
      String(id).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const existingPayments = [];
    const seenScheduleIds = new Set();
    
    if (transactions?.length > 0) {
      for (const tx of transactions) {
        try {
          if (tx.metadata) {
            const metadata = typeof tx.metadata === 'string' ? JSON.parse(tx.metadata) : tx.metadata;
            
            if (metadata?.paymentScheduleId) {
              const scheduleIds = Array.isArray(metadata.paymentScheduleId) 
                ? metadata.paymentScheduleId 
                : [metadata.paymentScheduleId];
              
              const compareIds = payment_schedule_ids.map(id => String(id));
              
              for (const scheduleId of scheduleIds) {
                if (compareIds.includes(String(scheduleId)) && !seenScheduleIds.has(String(scheduleId))) {
                  seenScheduleIds.add(String(scheduleId));
                  existingPayments.push({
                    payment_schedule_id: scheduleId,
                    payment_head_name: formatScheduleName(scheduleId),
                    transaction_id: tx.id,
                    paid_at: tx.paid_at
                  });
                }
              }
            }
          }
        } catch (parseError) {
          logError('Error parsing transaction metadata', { txId: tx.id, error: parseError.message });
        }
      }
    }
    
    return paymentResponse.success(res, { existing_payments: existingPayments }, 'Existing payments checked');
    
  } catch (error) {
    logError('Check existing payments error', error);
    return paymentResponse.serverError(res, 'Failed to check existing payments');
  }
};

// GET /api/payments/car/:slug
export const getCarPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { slug } = req.params;
    
    const supabaseAdmin = getSupabaseAdmin();
    const { data: car, error } = await supabaseAdmin
      .from('cars')
      .select('id')
      .eq('slug', slug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();
    
    if (error || !car) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
    }
    
    const transactions = await getCarTransactions(car.id);
    
    return paymentResponse.success(res, { transactions }, 'Car payments retrieved');
  } catch (error) {
    logError('Get car payments error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve car payments');
  }
};

// GET /api/payment/car-receipt/:identifier
export const getCarPaymentReceipt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { identifier } = req.params;
    
    const supabaseAdmin = getSupabaseAdmin();
    
    let car;
    let transaction = null;
    const isNumeric = /^\d+$/.test(identifier);
    
    if (isNumeric) {
      try {
        const order = await getOrderByNumber(identifier);
        if (order && order.user_id === userId && order.transaction_id) {
          const { getTransactionById } = await import('../../services/payment/transaction.service.js');
          transaction = await getTransactionById(order.transaction_id);
          if (transaction?.car_id) {
            const { data: carFromOrder } = await supabaseAdmin
              .from('cars')
              .select('id, slug')
              .eq('id', transaction.car_id)
              .eq('user_id', userId)
              .is('deleted_at', null)
              .single();
            
            if (carFromOrder) car = carFromOrder;
          }
        }
      } catch (orderError) {
        // Not an order number — fall through to car ID lookup
      }
      
      if (!car) {
        const { data: carById } = await supabaseAdmin
          .from('cars')
          .select('id, slug')
          .eq('id', parseInt(identifier))
          .eq('user_id', userId)
          .is('deleted_at', null)
          .single();
        
        if (carById) car = carById;
      }
    } else {
      const { data: carBySlug } = await supabaseAdmin
        .from('cars')
        .select('id, slug')
        .eq('slug', identifier)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();
      
      if (carBySlug) car = carBySlug;
    }
    
    if (!car) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
    }
    
    if (!transaction) {
      const transactions = await getCarTransactions(car.id, { status: PAYMENT_STATUS.SUCCESSFUL });
      if (transactions?.length > 0) transaction = transactions[0];
    }
    
    if (!transaction) {
      return paymentResponse.notFound(res, 'No successful payment found for this car');
    }
    
    let order = null;
    try {
      order = await getOrderByTransactionId(transaction.id);
    } catch (orderError) {
      // Order may not exist for older transactions
    }
    
    return paymentResponse.success(res, {
      transaction: {
        id: transaction.id,
        reference: transaction.reference,
        amount: transaction.amount,
        status: transaction.status,
        paid_at: transaction.paid_at,
        created_at: transaction.created_at
      },
      order: order ? {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        amount_paid: order.amount_paid,
        delivery_address: order.delivery_address || null,
        delivery_fee: order.delivery_fee || 0,
        delivery_contact: order.delivery_contact || null,
      } : null,
      car: { id: car.id, slug: car.slug }
    }, 'Payment receipt retrieved');
    
  } catch (error) {
    logError('Get car payment receipt error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve payment receipt');
  }
};
