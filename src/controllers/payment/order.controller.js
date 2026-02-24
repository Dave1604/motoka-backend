import { logError } from '../../utils/logger.js';
import { paymentResponse } from './payment-response.util.js';
import {
  getUserOrders,
  getOrderByNumber,
  OrderError
} from '../../services/payment/order.service.js';
import {
  ERROR_MESSAGES
} from '../../constants/payment.constants.js';

/**
 * Order Controller
 * 
 * Handles order-related endpoints.
 */

/**
 * Get user's orders
 * GET /api/orders
 */
export const getUserOrdersHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, status } = req.query;
    
    const result = await getUserOrders(userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || undefined
    });
    
    return paymentResponse.success(res, result, 'Orders retrieved');
  } catch (error) {
    logError('Get user orders error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve orders');
  }
};

/**
 * Get a specific order by number
 * GET /api/orders/:orderNumber
 */
export const getOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderNumber } = req.params;
    
    const order = await getOrderByNumber(orderNumber);
    
    if (!order) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.ORDER_NOT_FOUND);
    }
    
    // Verify user owns this order
    if (order.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    return paymentResponse.success(res, { order }, 'Order retrieved');
  } catch (error) {
    logError('Get order error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve order');
  }
};
