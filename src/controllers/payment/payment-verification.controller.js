import { logError, logDebug, logWarn } from '../../utils/logger.js';
import { getUserFriendlyMessage } from '../../utils/errorSanitizer.js';
import paymentMetrics from '../../services/payment/metrics.service.js';
import { paymentResponse } from './payment-response.util.js';
import { GatewayFactory } from '../../services/payment/gateway/gateway.factory.js';
import { GatewayError } from '../../services/payment/gateway/gateway.interface.js';
import {
  getTransactionByReference,
  getTransactionByPaystackReference,
  getTransactionByMonicreditOrderId,
  getTransactionById,
  updateTransactionStatus,
  markTransactionAbandoned,
  processPaymentSuccess,
  TransactionError
} from '../../services/payment/transaction.service.js';
import {
  getOrderById,
  getOrderByTransactionId,
  OrderError
} from '../../services/payment/order.service.js';
import {
  validatePaymentAmount,
  AmountValidationError
} from '../../services/payment/validation/amount.validator.js';
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  PAYMENT_GATEWAY,
  ORDER_TYPE,
  HTTP_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES
} from '../../constants/payment.constants.js';
import { PaystackError } from '../../services/payment/paystack.service.js';
import { MonicreditError } from '../../services/payment/monicredit/index.js';
import { PaymentSuccessService } from '../../services/payment/payment-success.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import {
  updateTransactionWithPaystackInit,
  updateTransactionWithMonicreditInit
} from '../../services/payment/transaction.service.js';
import {
  createTransaction
} from '../../services/payment/transaction.service.js';

/**
 * Payment Verification Controller
 * 
 * Handles payment verification, retry, and cancellation endpoints.
 */

/**
 * Verify payment status
 * GET /api/payments/verify/:reference
 */
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    logDebug('[Verify Payment] Starting verification', {
      reference,
      userId,
      timestamp: new Date().toISOString()
    });
    
    // Resolution order: internal reference → Paystack reference → Monicredit order ID
    let transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      logDebug('[Verify Payment] Transaction not found by our reference, trying gateway-specific lookups', { reference });
      transaction = await getTransactionByPaystackReference(reference);
      if (!transaction) {
        transaction = await getTransactionByMonicreditOrderId(reference);
      }
    }
    
    if (!transaction) {
      logError('Transaction not found for verification', {
        reference,
        userId
      });
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    const paymentGateway = transaction.payment_gateway || PAYMENT_GATEWAY.MONICREDIT;
    
    logDebug('[Verify Payment] Found transaction', {
      id: transaction.id,
      reference: transaction.reference,
      payment_gateway: paymentGateway,
      status: transaction.status
    });
    
    if (transaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    // Parse metadata
    let metaData = {};
    try {
      metaData = typeof transaction.metadata === 'string' 
        ? JSON.parse(transaction.metadata) 
        : (transaction.metadata || {});
    } catch (e) {
      logError('Failed to parse transaction metadata', {
        error: e.message,
        transactionId: transaction.id
      });
      return paymentResponse.error(res, 
        'Payment data corrupted. Please contact support with reference: ' + transaction.reference,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    // If already successful, return early
    if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
      let carSlug = metaData?.carSlug;
      if (!carSlug && transaction.car_id) {
        try {
          const supabaseAdmin = getSupabaseAdmin();
          const { data: carData } = await supabaseAdmin
            .from('cars')
            .select('slug')
            .eq('id', transaction.car_id)
            .single();
          carSlug = carData?.slug;
        } catch (carError) {
          logWarn('[Verify Payment] Failed to get car slug', { carId: transaction.car_id });
        }
      }
      
      // For Monicredit, return status as "APPROVED" to match frontend expectations
      const statusForResponse = paymentGateway === PAYMENT_GATEWAY.MONICREDIT 
        ? 'APPROVED' 
        : 'success';
      
      return paymentResponse.success(res, {
        status: statusForResponse,
        message: 'Payment verified successfully',
        reference: transaction.reference,
        transaction_id: transaction.id,
        amount: transaction.amount,
        paid_at: transaction.paid_at,
        car_id: transaction.car_id,
        car_slug: carSlug
      }, SUCCESS_MESSAGES.PAYMENT_VERIFIED);
    }
    
    // Get gateway adapter
    const gateway = GatewayFactory.getGateway(paymentGateway);
    
    // Verify with gateway
    let verifyTransactionId = transaction.reference;
    if (paymentGateway === PAYMENT_GATEWAY.MONICREDIT) {
      verifyTransactionId = transaction.monicredit_order_id || transaction.monicredit_transaction_id || transaction.reference;
    } else if (paymentGateway === PAYMENT_GATEWAY.PAYSTACK) {
      verifyTransactionId = transaction.paystack_reference || transaction.reference;
    }
    
    const verifyStartTime = Date.now();
    let gatewayResult;
    
    try {
      gatewayResult = await gateway.verifyPayment(verifyTransactionId);
    } catch (verifyError) {
      const verifyProcessingTime = Date.now() - verifyStartTime;
      logError('Gateway verification failed', {
        transactionId: verifyTransactionId,
        error: verifyError.message,
        processingTime: verifyProcessingTime
      });
      
      let errorType = 'other';
      if (verifyError.code === 'REQUEST_TIMEOUT') errorType = 'timeout';
      else if (verifyError.code === 'REQUEST_FAILED') errorType = 'network';
      else if (verifyError.code === 'API_ERROR') errorType = 'api';
      
      paymentMetrics.trackFailure({
        gateway: paymentGateway,
        amount: transaction.amount,
        errorType
      });
      
      if (verifyError instanceof PaystackError || verifyError instanceof MonicreditError) {
        return paymentResponse.error(res, verifyError.message, verifyError.statusCode);
      }
      return paymentResponse.error(res, ERROR_MESSAGES.PAYMENT_VERIFY_FAILED, HTTP_STATUS.SERVER_ERROR);
    }
    
    const verifyProcessingTime = Date.now() - verifyStartTime;
    
    // Check if payment is successful
    const isSuccess = gatewayResult.success === true || 
      (gatewayResult.status === 'success' || gatewayResult.status === 'approved');
    
    if (!isSuccess) {
      return paymentResponse.success(res, {
        status: gatewayResult.status || 'pending',
        message: 'Payment verification pending',
        reference: transaction.reference,
        transaction_id: transaction.id,
        amount: transaction.amount,
        gateway: paymentGateway
      }, 'Payment verification pending');
    }
    
    // Validate amount
    const gatewayAmount = gatewayResult.amount || 0;
    const expectedAmount = transaction.amount;
    
    try {
      validatePaymentAmount(expectedAmount, gatewayAmount, 1);
    } catch (error) {
      if (error instanceof AmountValidationError) {
        logError('Payment amount mismatch', {
          reference,
          expectedAmount_kobo: expectedAmount,
          actualAmount_kobo: gatewayAmount,
          difference_kobo: error.difference
        });
        
        paymentMetrics.trackAmountValidation({
          mismatch: true,
          rejected: true
        });
        
        return paymentResponse.error(
          res,
          `Payment amount mismatch: expected ${expectedAmount / 100} NGN, received ${gatewayAmount / 100} NGN.`,
          400
        );
      }
      throw error;
    }
    
    // Process successful payment
    if (transaction.status === PAYMENT_STATUS.PENDING) {
      logDebug('[Verify Payment] Payment approved, processing payment success');
      
      const isSubscription = metaData?.subscription_id || metaData?.is_subscription;
      const orderType = isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL;
      const paymentScheduleIds = metaData?.paymentScheduleId || metaData?.payment_schedule_id || metaData?.selected_items || [];
      
      try {
        await updateTransactionStatus(transaction.reference, {
          status: PAYMENT_STATUS.SUCCESSFUL,
          channel: gatewayResult.channel || 'bank_transfer',
          authorization_code: gatewayResult.authorization?.authorization_code || null,
          paid_at: gatewayResult.paid_at || new Date().toISOString()
        });
        
        const processResult = await processPaymentSuccess({
          reference: transaction.reference,
          status: PAYMENT_STATUS.SUCCESSFUL,
          channel: gatewayResult.channel || 'bank_transfer',
          authorization_code: gatewayResult.authorization?.authorization_code || null,
          paid_at: gatewayResult.paid_at || new Date().toISOString(),
          orderType,
          renewalMonths: metaData?.renewal_months || 12,
          selectedItems: paymentScheduleIds,
          renewalAmount: metaData?.renewal_amount || transaction.amount,
          deliveryFee: metaData?.delivery_fee || 0,
          deliveryAddress: metaData?.delivery_details?.address || metaData?.delivery_address,
          deliveryState: metaData?.delivery_details?.state || metaData?.delivery_state,
          deliveryLGA: metaData?.delivery_details?.lga || metaData?.delivery_lga,
          deliveryContact: metaData?.delivery_details?.contact || metaData?.delivery_contact,
          metadata: metaData
        });
        
        paymentMetrics.trackSuccess({
          gateway: paymentGateway,
          amount: transaction.amount,
          processingTime: verifyProcessingTime
        });
        
        const updatedTransaction = await getTransactionByReference(reference);
        const createdOrder = processResult.orderId ? await getOrderById(processResult.orderId).catch(() => null) : null;
        
        // Process side-effects
        if (!processResult.alreadyProcessed) {
          await PaymentSuccessService.processPaymentSuccessSideEffects({
            transaction: updatedTransaction,
            gatewayData: gatewayResult,
            order: createdOrder
          });
        }
        
        let carSlug = metaData?.carSlug;
        if (!carSlug && updatedTransaction.car_id) {
          const supabaseAdmin = getSupabaseAdmin();
          const { data: carData } = await supabaseAdmin
            .from('cars')
            .select('slug')
            .eq('id', updatedTransaction.car_id)
            .single();
          carSlug = carData?.slug;
        }
        
        // For Monicredit, return status as "APPROVED" to match frontend expectations
        // For Paystack, return "success" 
        const statusForResponse = paymentGateway === PAYMENT_GATEWAY.MONICREDIT 
          ? 'APPROVED' 
          : 'success';
        
        return paymentResponse.success(res, {
          status: statusForResponse,
          message: 'Payment verified successfully',
          reference: updatedTransaction.reference,
          transaction_id: updatedTransaction.id,
          amount: updatedTransaction.amount,
          paid_at: updatedTransaction.paid_at,
          car_id: updatedTransaction.car_id,
          car_slug: carSlug,
          order_id: createdOrder?.id || null,
          order_number: createdOrder?.order_number || null,
          gateway: paymentGateway
        }, SUCCESS_MESSAGES.PAYMENT_VERIFIED);
      } catch (processError) {
        logError('Failed to process payment success', {
          error: processError,
          reference
        });
        
        return paymentResponse.success(res, {
          status: 'success',
          message: 'Payment verified but processing encountered an error',
          reference: transaction.reference,
          transaction_id: transaction.id,
          amount: transaction.amount,
          warning: 'Please contact support if order was not created'
        }, 'Payment verified with processing warning');
      }
    }
    
    // Already processed
    let carSlug = metaData?.carSlug;
    if (!carSlug && transaction.car_id) {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: carData } = await supabaseAdmin
        .from('cars')
        .select('slug')
        .eq('id', transaction.car_id)
        .single();
      carSlug = carData?.slug;
    }
    
    // For Monicredit, return status as "APPROVED" to match frontend expectations
    const statusForResponse = paymentGateway === PAYMENT_GATEWAY.MONICREDIT 
      ? 'APPROVED' 
      : 'success';
    
    return paymentResponse.success(res, {
      status: statusForResponse,
      message: 'Payment already verified',
      reference: transaction.reference,
      transaction_id: transaction.id,
      amount: transaction.amount,
      paid_at: transaction.paid_at,
      car_id: transaction.car_id,
      car_slug: carSlug,
      gateway: paymentGateway
    }, SUCCESS_MESSAGES.PAYMENT_VERIFIED);
    
  } catch (error) {
    logError('Verify payment error', error);
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof PaystackError || error instanceof MonicreditError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode);
    }
    if (error instanceof AmountValidationError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, 400);
    }
    
    return paymentResponse.serverError(res, isProduction ? 'Failed to verify payment' : error.message);
  }
};

/**
 * Get transaction details
 * GET /api/payments/:reference
 */
export const getTransaction = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    const transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    if (transaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    let metaData = {};
    try {
      metaData = typeof transaction.metadata === 'string' 
        ? JSON.parse(transaction.metadata) 
        : (transaction.metadata || {});
    } catch (e) {
      logError('Failed to parse transaction metadata', {
        error: e.message,
        transactionId: transaction.id
      });
    }
    
    return paymentResponse.success(res, {
      id: transaction.id,
      reference: transaction.reference,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      payment_type: transaction.payment_type,
      channel: transaction.channel,
      created_at: transaction.created_at,
      paid_at: transaction.paid_at,
      updated_at: transaction.updated_at,
      car_id: transaction.car_id,
      car_slug: metaData?.carSlug,
      webhook_event_id: transaction.webhook_event_id,
      webhook_processed_at: transaction.webhook_processed_at
    }, 'Transaction retrieved');
    
  } catch (error) {
    logError('Get transaction error', error);
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof TransactionError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, isProduction ? 'Failed to retrieve transaction' : error.message);
  }
};

/**
 * Get transaction status (lightweight)
 * GET /api/payments/:reference/status
 */
export const getTransactionStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    const transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    if (transaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    return paymentResponse.success(res, {
      reference: transaction.reference,
      status: transaction.status,
      amount: transaction.amount,
      created_at: transaction.created_at,
      paid_at: transaction.paid_at
    }, 'Transaction status retrieved');
    
  } catch (error) {
    logError('Get transaction status error', error);
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof TransactionError) {
      const message = isProduction ? 'Failed to retrieve transaction status' : error.message;
      return paymentResponse.error(res, message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to retrieve transaction status');
  }
};

/**
 * Cancel payment
 * PUT /api/payments/:reference/cancel
 */
export const cancelPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    const rawReason = req.body?.reason;
    // Sanitize and length-cap reason to prevent injection and excessive data
    const reason = rawReason ? String(rawReason).trim().slice(0, 255) : null;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    const transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    if (transaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    if (transaction.status !== PAYMENT_STATUS.PENDING) {
      return paymentResponse.error(
        res,
        `Cannot cancel payment with status: ${transaction.status}. Only pending payments can be cancelled.`,
        HTTP_STATUS.CONFLICT
      );
    }
    
    await markTransactionAbandoned(reference);
    
    return paymentResponse.success(res, {
      reference: transaction.reference,
      status: PAYMENT_STATUS.ABANDONED,
      message: reason || 'Payment cancelled by user'
    }, 'Payment cancelled successfully');
    
  } catch (error) {
    logError('Cancel payment error', error);
    
    if (error instanceof TransactionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to cancel payment');
  }
};

/**
 * Retry payment
 * POST /api/payments/:reference/retry
 */
export const retryPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    const originalTransaction = await getTransactionByReference(reference);
    
    if (!originalTransaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    if (originalTransaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    // Guard against retrying non-retryable statuses
    const NON_RETRYABLE = [
      PAYMENT_STATUS.SUCCESSFUL,
      PAYMENT_STATUS.REFUNDED,
      PAYMENT_STATUS.ABANDONED
    ];
    
    if (NON_RETRYABLE.includes(originalTransaction.status)) {
      return paymentResponse.error(
        res,
        `Cannot retry a ${originalTransaction.status} payment`,
        HTTP_STATUS.CONFLICT
      );
    }
    
    let metaData = {};
    try {
      metaData = typeof originalTransaction.metadata === 'string' 
        ? JSON.parse(originalTransaction.metadata) 
        : (originalTransaction.metadata || {});
    } catch (e) {
      logError('Failed to parse metadata in retryPayment', {
        error: e.message,
        transactionId: originalTransaction.id
      });
      return paymentResponse.error(
        res,
        'Cannot retry payment: corrupted payment data',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }
    
    const newTransaction = await createTransaction({
      userId,
      carId: originalTransaction.car_id,
      amount: originalTransaction.amount,
      paymentType: originalTransaction.payment_type,
      paymentGateway: originalTransaction.payment_gateway || PAYMENT_GATEWAY.MONICREDIT,
      metadata: {
        ...metaData,
        retry_of: reference,
        retry_at: new Date().toISOString()
      }
    });
    
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();
    
    if (!profile?.email) {
      return paymentResponse.error(res, 'User email not found', HTTP_STATUS.BAD_REQUEST);
    }
    
    
    const retryGateway = originalTransaction.payment_gateway || PAYMENT_GATEWAY.MONICREDIT;
    const gateway = GatewayFactory.getGateway(retryGateway);
    
    // Get car data for gateway initialization
    const { data: car } = await supabaseAdmin
      .from('cars')
      .select('*')
      .eq('id', originalTransaction.car_id)
      .single();
    
    if (!car) {
      return paymentResponse.error(res, 'Car not found', HTTP_STATUS.NOT_FOUND);
    }
    
    // Initialize payment with the correct gateway
    const gatewayResult = await gateway.initializePayment({
      userId,
      userEmail: profile.email,
      transaction: newTransaction,
      car,
      paymentScheduleIds: metaData?.paymentScheduleId || metaData?.payment_schedule_id || [],
      renewalMonths: metaData?.renewal_months || 12,
      paymentType: originalTransaction.payment_type,
      renewalAmount: metaData?.renewal_amount || newTransaction.amount,
      deliveryFee: metaData?.delivery_fee || 0,
      deliveryData: metaData?.delivery_details || null,
      hasDeliveryDetails: !!metaData?.delivery_details
    });
    
    // Update transaction using the correct gateway updater
    if (retryGateway === PAYMENT_GATEWAY.MONICREDIT) {
      await updateTransactionWithMonicreditInit(newTransaction.reference, gatewayResult);
    } else {
      await updateTransactionWithPaystackInit(newTransaction.reference, gatewayResult);
    }
    
    // Build response based on gateway type
    const responseData = {
      reference: newTransaction.reference,
      transaction_id: newTransaction.id,
      amount: newTransaction.amount,
      original_reference: reference,
      gateway: retryGateway
    };
    
    // Add gateway-specific fields
    if (retryGateway === PAYMENT_GATEWAY.PAYSTACK) {
      responseData.authorization_url = gatewayResult.authorization_url;
      responseData.access_code = gatewayResult.access_code;
    } else if (retryGateway === PAYMENT_GATEWAY.MONICREDIT) {
      responseData.order_id = gatewayResult.order_id;
      responseData.account_number = gatewayResult.account_number;
      responseData.bank_name = gatewayResult.bank_name;
      responseData.account_name = gatewayResult.account_name;
    }
    
    return paymentResponse.created(res, responseData, 'Payment retry initialized successfully');
    
  } catch (error) {
    logError('Retry payment error', error);
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof PaystackError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode);
    }
    
    if (error instanceof TransactionError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, isProduction ? 'Failed to retry payment' : error.message);
  }
};
