import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logDebug, logWarn, logInfo } from '../../utils/logger.js';
import { sanitizeError, getUserFriendlyMessage } from '../../utils/errorSanitizer.js';
import paymentMetrics from '../../services/payment/metrics.service.js';
import { paymentResponse } from './payment-response.util.js';
import { GatewayFactory } from '../../services/payment/gateway/gateway.factory.js';
import { GatewayError } from '../../services/payment/gateway/gateway.interface.js';
import {
  createTransaction,
  updateTransactionWithPaystackInit,
  updateTransactionWithMonicreditInit,
  TransactionError
} from '../../services/payment/transaction.service.js';
import {
  validateRenewalItemsSelection
} from '../../services/payment/renewalItems.service.js';
import {
  getAllStates,
  getLGAsByState,
  resolveStateAndLGA
} from '../../services/location.service.js';
import {
  buildPaymentMetadata
} from '../../utils/paymentHelpers.js';
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  PAYMENT_GATEWAY,
  HTTP_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES
} from '../../constants/payment.constants.js';
import { PaystackError } from '../../services/payment/paystack.service.js';
import { MonicreditError } from '../../services/payment/monicredit/index.js';

/**
 * Payment Initialization Controller
 * 
 * Handles payment initialization endpoints and related configuration.
 */

/**
 * Get available renewal items
 * GET /api/payment-schedule
 */
export const getRenewalItems = async (req, res) => {
  try {
    const { getRenewalItems: getRenewalItemsFromDb } = await import('../../services/payment/renewalItems.service.js');
    const items = await getRenewalItemsFromDb();
    
    const transformedItems = items.map((item) => ({
      id: item.id,
      amount: item.price,
      name: item.name,
      required: item.required,
      payment_head: {
        id: item.id,
        payment_head_name: item.name
      }
    }));
    
    return paymentResponse.success(res, transformedItems, 'Renewal items retrieved');
  } catch (error) {
    logError('Get renewal items error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve renewal items');
  }
};

/**
 * Get payment heads
 * GET /api/payment-schedule/get-payment-head
 */
export const getPaymentHeads = async (req, res) => {
  try {
    const { getRenewalItems: getRenewalItemsFromDb } = await import('../../services/payment/renewalItems.service.js');
    const items = await getRenewalItemsFromDb();
    
    const paymentHeads = items.map((item) => ({
      id: item.id,
      payment_head_name: item.name,
      code: `REV_${item.id.toUpperCase()}`,
      type: item.required ? 'required' : 'optional',
      amount: item.price
    }));
    
    return paymentResponse.success(res, paymentHeads, 'Payment heads retrieved');
  } catch (error) {
    logError('Get payment heads error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve payment heads');
  }
};

/**
 * Get all states
 * GET /api/get-all-state
 */
export const getStates = async (req, res) => {
  try {
    const states = await getAllStates();
    
    const transformedStates = states.map((state) => ({
      id: state.id,
      state_name: state.name,
      name: state.name,
      code: state.code,
      delivery_fee: state.delivery_fee
    }));
    
    return paymentResponse.success(res, transformedStates, 'States retrieved');
  } catch (error) {
    logError('Get states error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve states');
  }
};

/**
 * Get LGAs by state
 * GET /api/payments/states/:stateCode/lgas
 * GET /api/get-lga/:stateCode
 */
export const getLGAs = async (req, res) => {
  try {
    const { stateCode } = req.params;
    
    const lgas = await getLGAsByState(stateCode);
    
    if (lgas.length === 0) {
      return paymentResponse.notFound(res, 'Invalid state code or state not found');
    }
    
    const formattedLgas = lgas.map((lgaName) => ({
      lga_name: lgaName,
      name: lgaName
    }));
    
    return paymentResponse.success(res, formattedLgas, 'Local governments retrieved');
  } catch (error) {
    logError('Get LGAs error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve local governments');
  }
};

/**
 * Get payment configuration
 * GET /api/payments/config
 */
export const getPaymentConfig = async (req, res) => {
  try {
    const publicKey = process.env.PAYSTACK_PUBLIC_KEY;
    
    if (!publicKey) {
      return paymentResponse.error(res, 'Payment not configured', HTTP_STATUS.SERVER_ERROR);
    }
    
    return paymentResponse.success(res, {
      public_key: publicKey,
      currency: 'NGN'
    }, 'Payment configuration retrieved');
  } catch (error) {
    logError('Get payment config error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve payment configuration');
  }
};

/**
 * Initialize payment
 * POST /api/payments/initialize
 */
export const initializePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { 
      car_slug, 
      payment_schedule_id = [], 
      renewal_months: rawRenewalMonths, 
      payment_type = PAYMENT_TYPE.RENEWAL_MANUAL,
      payment_gateway: rawPaymentGateway,
      delivery_details,
      meta_data
    } = req.body;
    
    // Validate renewal_months against allowlist
    const VALID_RENEWAL_MONTHS = [1, 3, 6, 12, 24];
    const rawMonths = parseInt(rawRenewalMonths);
    const renewal_months = VALID_RENEWAL_MONTHS.includes(rawMonths) ? rawMonths : 12;
    
    // Normalize payment gateway: handle case-insensitive input and various formats
    let payment_gateway = rawPaymentGateway;
    if (payment_gateway) {
      payment_gateway = payment_gateway.toLowerCase().trim();
    }
    
    // Default to Monicredit if not provided or invalid
    if (!payment_gateway || 
        (payment_gateway !== PAYMENT_GATEWAY.PAYSTACK && payment_gateway !== PAYMENT_GATEWAY.MONICREDIT)) {
      // Check if it's a valid gateway name in different case
      const normalized = payment_gateway?.toLowerCase();
      if (normalized === 'paystack' || normalized === 'monicredit') {
        payment_gateway = normalized;
      } else {
        // Invalid gateway - default to Monicredit but log warning
        if (payment_gateway) {
          logWarn('[Payment Init] Invalid gateway provided, defaulting to Monicredit', {
            provided: rawPaymentGateway,
            normalized: payment_gateway
          });
        }
        payment_gateway = PAYMENT_GATEWAY.MONICREDIT;
      }
    }
    
    logDebug('[Payment Init] Request received', {
      gateway: payment_gateway,
      rawGateway: rawPaymentGateway,
      userId,
      userEmail,
      carSlug: car_slug,
      paymentScheduleIds: payment_schedule_id,
      renewalMonths: renewal_months,
      paymentType: payment_type
    });
    
    // Validate gateway is supported
    if (!GatewayFactory.isSupported(payment_gateway)) {
      return paymentResponse.error(
        res,
        `Unsupported payment gateway: ${payment_gateway}. Supported gateways: ${GatewayFactory.getSupportedGateways().join(', ')}`,
        HTTP_STATUS.BAD_REQUEST
      );
    }
    
    const deliveryData = delivery_details || meta_data || {};
    
    const hasDeliveryDetails = !!(
      deliveryData &&
      (deliveryData.address || deliveryData.delivery_address || 
       deliveryData.state || deliveryData.state_id || 
       deliveryData.lga || deliveryData.lga_id || 
       deliveryData.delivery_contact || deliveryData.contact)
    );

    let stateValidation = { valid: true, delivery_fee: 0 };
    
    if (hasDeliveryDetails) {
      const address = deliveryData.address || deliveryData.delivery_address;
      const stateInput = deliveryData.state_id !== undefined ? deliveryData.state_id : deliveryData.state;
      const lgaInput = deliveryData.lga_id !== undefined ? deliveryData.lga_id : deliveryData.lga;
      const contact = deliveryData.contact || deliveryData.delivery_contact;
      
      if (!address || stateInput === undefined || stateInput === null || lgaInput === undefined || lgaInput === null || !contact) {
        return paymentResponse.error(
          res,
          'Delivery details are incomplete. Provide address, state/state_id, lga/lga_id, and contact, or omit delivery details entirely.',
          HTTP_STATUS.BAD_REQUEST
        );
      }
      
      stateValidation = await resolveStateAndLGA(stateInput, lgaInput);
      if (!stateValidation.valid) {
        return paymentResponse.error(res, stateValidation.error, HTTP_STATUS.BAD_REQUEST);
      }
      
      deliveryData.state = stateValidation.stateCode || (typeof stateInput === 'string' ? stateInput : null);
      deliveryData.lga = stateValidation.lgaName || (typeof lgaInput === 'string' ? lgaInput : null);
    }
    
    const validation = await validateRenewalItemsSelection(payment_schedule_id);
    if (!validation.valid) {
      return paymentResponse.error(res, validation.error, HTTP_STATUS.BAD_REQUEST);
    }
    
    const renewalAmount = validation.total;
    const deliveryFee = stateValidation.delivery_fee;
    const amount = renewalAmount + deliveryFee;
    
    logDebug('[Payment Init] Amount breakdown', {
      payment_schedule_id,
      renewalAmount_kobo: renewalAmount,
      renewalAmount_naira: renewalAmount / 100,
      deliveryFee_kobo: deliveryFee,
      deliveryFee_naira: deliveryFee / 100,
      totalAmount_kobo: amount,
      totalAmount_naira: amount / 100,
      hasDeliveryDetails,
      stateCode: stateValidation.stateCode,
      userId,
      car_slug
    });
    
    const supabaseAdmin = getSupabaseAdmin();
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('id, slug, vehicle_make, vehicle_model, registration_no, expiry_date, status, user_id')
      .eq('slug', car_slug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();
    
    if (carError || !car) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
    }
    
    const transaction = await createTransaction({
      userId,
      carId: car.id,
      amount,
      paymentType: payment_type,
      paymentGateway: payment_gateway,
      metadata: buildPaymentMetadata({
        carId: car.id,
        carSlug: car_slug,
        paymentType: payment_type,
        renewalMonths: renewal_months,
        paymentScheduleId: payment_schedule_id,
        renewalAmount,
        deliveryFee,
        deliveryDetails: hasDeliveryDetails ? deliveryData : null,
        userId,
        paymentGateway: payment_gateway
      })
    });
    
    const initStartTime = Date.now();
    paymentMetrics.trackInitialization({
      gateway: payment_gateway,
      amount
    });
    
    // Get gateway adapter using factory
    let gateway;
    try {
      gateway = GatewayFactory.getGateway(payment_gateway);
      logInfo('[Payment Init] Initializing payment with gateway', {
        gateway: payment_gateway,
        gatewayAdapter: gateway?.constructor?.name || typeof gateway,
        reference: transaction.reference,
        userId,
        userEmail
      });
    } catch (gatewayError) {
      logError('[Payment Init] Failed to get gateway adapter', {
        error: gatewayError.message,
        gateway: payment_gateway,
        errorStack: gatewayError.stack
      });
      throw gatewayError;
    }
    
    logDebug('[Payment Init] Starting gateway initialization', {
      gateway: payment_gateway,
      reference: transaction.reference,
      userId,
      userEmail,
      paymentScheduleIds: payment_schedule_id,
      renewalAmount,
      deliveryFee
    });
    
    let gatewayResult;
    try {
      gatewayResult = await gateway.initializePayment({
        userId,
        userEmail,
        transaction,
        car,
        paymentScheduleIds: payment_schedule_id,
        renewalMonths: renewal_months,
        paymentType: payment_type,
        renewalAmount,
        deliveryFee,
        deliveryData,
        hasDeliveryDetails
      });
      
      logDebug('[Payment Init] Gateway initialization successful', {
        gateway: payment_gateway,
        reference: transaction.reference,
        hasResult: !!gatewayResult,
        resultKeys: gatewayResult ? Object.keys(gatewayResult) : []
      });
    } catch (initError) {
      logError('[Payment Init] Gateway initialization failed', {
        gateway: payment_gateway,
        error: initError.message,
        errorName: initError.name,
        errorCode: initError.code,
        statusCode: initError.statusCode,
        errorStack: initError.stack,
        reference: transaction.reference,
        userId,
        userEmail
      });
      throw initError;
    }
    
    // Update transaction with gateway-specific data
    if (payment_gateway === PAYMENT_GATEWAY.MONICREDIT) {
      await updateTransactionWithMonicreditInit(transaction.reference, gatewayResult);
    } else {
      await updateTransactionWithPaystackInit(transaction.reference, gatewayResult);
    }
    
    const initProcessingTime = Date.now() - initStartTime;
    paymentMetrics.trackInitialization({
      gateway: payment_gateway,
      amount,
      processingTime: initProcessingTime
    });
    
    // Build response based on gateway
    const responseData = {
      reference: transaction.reference,
      transaction_id: transaction.id,
      gateway: payment_gateway
    };
    
    if (payment_gateway === PAYMENT_GATEWAY.MONICREDIT) {
      // Convert amounts from kobo to naira for frontend display
      // (gatewayResult.total_amount and amount are in kobo)
      const totalAmountInNaira = gatewayResult.total_amount ? gatewayResult.total_amount / 100 : 0;
      const amountInNaira = amount / 100; // Convert transaction amount from kobo to naira
      
      Object.assign(responseData, {
        order_id: gatewayResult.order_id,                         // Fixed: was gatewayResult.gateway_reference (undefined)
        transaction_id_monicredit: gatewayResult.transaction_id,  // Fixed: was gatewayResult.gateway_reference (undefined)
        customer: gatewayResult.customer,
        account_number: gatewayResult.account_number,
        bank_name: gatewayResult.bank_name,
        account_name: gatewayResult.account_name,
        payment_url: gatewayResult.authorization_url || null,
        checkout_url: gatewayResult.authorization_url || null,
        total_amount: totalAmountInNaira, // Send in naira for frontend display
        amount: amountInNaira, // Also convert amount field to naira
        expires_at: gatewayResult.expires_at
      });
    } else {
      // For Paystack, amount stays in kobo (as expected by Paystack)
      Object.assign(responseData, {
        authorization_url: gatewayResult.authorization_url,
        access_code: gatewayResult.access_code,
        amount: amount // Paystack uses kobo
      });
    }
    
    return paymentResponse.success(res, responseData, SUCCESS_MESSAGES.PAYMENT_INITIALIZED);
    
  } catch (error) {
    logError('Initialize payment error', {
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      statusCode: error.statusCode,
      errorStack: error.stack,
      gateway: req.body?.payment_gateway || 'unknown',
      userId: req.user?.id,
      userEmail: req.user?.email,
      carSlug: req.body?.car_slug,
      paymentScheduleIds: req.body?.payment_schedule_id
    });
    
    let errorType = 'other';
    if (error.code === 'REQUEST_TIMEOUT' || error.name === 'AbortError') {
      errorType = 'timeout';
    } else if (error.code === 'REQUEST_FAILED' || error.message.includes('fetch')) {
      errorType = 'network';
    } else if (error.code === 'API_ERROR' || error.statusCode >= 500) {
      errorType = 'api';
    } else if (error.code === 'VALIDATION_ERROR' || error.code === 'CONFIG_ERROR') {
      errorType = 'validation';
    }
    
    paymentMetrics.trackFailure({
      gateway: req.body?.payment_gateway || 'unknown',
      amount: req.body?.amount || 0,
      errorType
    });
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof PaystackError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode || 500);
    }
    if (error instanceof MonicreditError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      logError('[Payment Init] MonicreditError details', {
        message: error.message,
        statusCode: error.statusCode,
        code: error.code,
        data: error.data
      });
      return paymentResponse.error(res, message, error.statusCode || 500);
    }
    if (error instanceof TransactionError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode || 500);
    }
    if (error instanceof GatewayError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode || 500);
    }
    
    // Generic error - return detailed message in development
    const errorMessage = isProduction 
      ? 'Failed to initialize payment' 
      : `${error.message || 'Unknown error'} (${error.name || 'Error'})`;
    
    return paymentResponse.serverError(res, errorMessage);
  }
};
