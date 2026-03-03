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
  buildPaymentMetadata,
  nairaToKobo
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
import {
  getIdempotencyResponse,
  reserveIdempotencyKey,
  storeIdempotencyResponse
} from '../../services/payment/idempotency.service.js';
import { logPaymentAudit } from '../../services/payment/audit.service.js';

// GET /api/payment-schedule
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

// GET /api/payment-schedule/get-payment-head
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

// GET /api/get-all-state
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

// GET /api/payments/states/:stateCode/lgas  |  GET /api/get-lga/:stateCode
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

// GET /api/payments/config
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

// POST /api/payments/initialize
export const initializePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];

    // Idempotency: return cached response if same key was used recently
    if (idempotencyKey) {
      const existing = await getIdempotencyResponse(idempotencyKey, userId);
      if (existing?.cached && existing.response) {
        logDebug('[Payment Init] Returning cached idempotency response', { key: idempotencyKey.slice(0, 8) });
        if (existing.status === 'failed') {
          return res.status(existing.response.statusCode || 500).json({
            status: false,
            message: existing.response.error || 'Payment initialization failed'
          });
        }
        return paymentResponse.success(res, existing.response, SUCCESS_MESSAGES.PAYMENT_INITIALIZED);
      }
      if (existing?.status === 'processing') {
        return res.status(409).json({
          status: false,
          message: 'A payment with this idempotency key is already being processed. Please retry in a few seconds.'
        });
      }
      const reserved = await reserveIdempotencyKey(idempotencyKey, userId);
      if (!reserved) {
        const retry = await getIdempotencyResponse(idempotencyKey, userId);
        if (retry?.cached && retry.response) {
          return paymentResponse.success(res, retry.response, SUCCESS_MESSAGES.PAYMENT_INITIALIZED);
        }
        return res.status(409).json({
          status: false,
          message: 'Duplicate request. Retry in a few seconds.'
        });
      }
    }

    const { 
      car_slug, 
      payment_schedule_id = [], 
      renewal_months: rawRenewalMonths, 
      payment_type = PAYMENT_TYPE.RENEWAL_MANUAL,
      payment_gateway: rawPaymentGateway,
      delivery_details,
      meta_data,
      // Plate number specific fields
      plate_type,
      sub_type = null,
      // Driver license specific
      license_type = null,
      duration = null          // '3yr' | '5yr' | 'international'
    } = req.body;

    const isPlatePayment = payment_type === PAYMENT_TYPE.PLATE_NUMBER;
    const isDriverLicensePayment = payment_type === PAYMENT_TYPE.DRIVER_LICENSE;
    const isNonCarPayment = isPlatePayment || isDriverLicensePayment;

    // ── Renewal months (not applicable for plate or driver license payments) ─
    const VALID_RENEWAL_MONTHS = [1, 3, 6, 12, 24];
    let renewal_months = 0;
    if (!isNonCarPayment) {
      const rawMonths = parseInt(rawRenewalMonths);
      if (!rawRenewalMonths || isNaN(rawMonths)) {
        renewal_months = 12;
      } else if (!VALID_RENEWAL_MONTHS.includes(rawMonths)) {
        return res.status(400).json({
          status: false,
          message: `Invalid renewal_months. Must be one of: ${VALID_RENEWAL_MONTHS.join(', ')}`,
        });
      } else {
        renewal_months = rawMonths;
      }
    }
    
    let payment_gateway = rawPaymentGateway?.toLowerCase().trim() || null;
    
    if (!payment_gateway ||
        (payment_gateway !== PAYMENT_GATEWAY.PAYSTACK && payment_gateway !== PAYMENT_GATEWAY.MONICREDIT)) {
      if (payment_gateway) {
        logWarn('[Payment Init] Invalid gateway provided, defaulting to Monicredit', {
          provided: rawPaymentGateway
        });
      }
      payment_gateway = PAYMENT_GATEWAY.MONICREDIT;
    }
    
    logDebug('[Payment Init] Request received', {
      gateway: payment_gateway,
      userId,
      carSlug: car_slug,
      paymentType: payment_type,
      renewalMonths: renewal_months
    });
    
    if (!GatewayFactory.isSupported(payment_gateway)) {
      return paymentResponse.error(
        res,
        `Unsupported payment gateway: ${payment_gateway}. Supported: ${GatewayFactory.getSupportedGateways().join(', ')}`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // ── Delivery (only for car renewal payments) ─────────────────────────────
    let deliveryData = {};
    let hasDeliveryDetails = false;
    let stateValidation = { valid: true, delivery_fee: 0 };

    if (!isNonCarPayment) {
      deliveryData = delivery_details || meta_data || {};

      hasDeliveryDetails = !!(
        deliveryData &&
        (deliveryData.address || deliveryData.delivery_address || 
         deliveryData.state || deliveryData.state_id || 
         deliveryData.lga || deliveryData.lga_id || 
         deliveryData.delivery_contact || deliveryData.contact)
      );
      
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
    }

    // ── Amount calculation ──────────────────────────────────────────────────
    let renewalAmount, deliveryFee, amount;

    if (isPlatePayment) {
      // Plate number: price comes from plate_number_prices table
      if (!plate_type) {
        return paymentResponse.error(res, 'plate_type is required for plate number payments', HTTP_STATUS.BAD_REQUEST);
      }

      const supabaseAdmin = getSupabaseAdmin();
      let priceQuery = supabaseAdmin
        .from('plate_number_prices')
        .select('*')
        .eq('plate_type', plate_type);

      if (sub_type) {
        priceQuery = priceQuery.eq('sub_type', sub_type);
      } else {
        priceQuery = priceQuery.is('sub_type', null);
      }

      const { data: priceData, error: priceError } = await priceQuery.single();

      if (priceError || !priceData) {
        return paymentResponse.error(
          res,
          `No price configured for plate type "${plate_type}"${sub_type ? ` / sub-type "${sub_type}"` : ''}`,
          HTTP_STATUS.BAD_REQUEST
        );
      }

      // Prices stored in naira → convert to kobo
      renewalAmount = nairaToKobo(Number(priceData.price));
      deliveryFee = 0;
      amount = renewalAmount;

      logDebug('[Payment Init] Plate payment amount', {
        plateType: plate_type,
        subType: sub_type,
        amountNaira: priceData.price
      });
    } else if (isDriverLicensePayment) {
      // Driver license: price from driver_license_prices (license_type + duration)
      const validTypes = ['new', 'renew'];
      const validDurations = ['3yr', '5yr', 'international'];
      if (!license_type || !validTypes.includes(String(license_type).toLowerCase())) {
        return paymentResponse.error(
          res,
          'license_type is required for driver license payments and must be "new" or "renew"',
          HTTP_STATUS.BAD_REQUEST
        );
      }
      const normDuration = duration ? String(duration).toLowerCase() : null;
      if (normDuration && !validDurations.includes(normDuration)) {
        return paymentResponse.error(
          res,
          `duration must be one of: ${validDurations.join(', ')}`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
      const supabaseAdmin = getSupabaseAdmin();
      let priceQuery = supabaseAdmin
        .from('driver_license_prices')
        .select('*')
        .eq('license_type', String(license_type).toLowerCase())
        .eq('is_active', true);
      if (normDuration) {
        priceQuery = priceQuery.eq('duration', normDuration);
      } else {
        // Legacy: no duration provided – pick the first available price for this type
        priceQuery = priceQuery.is('duration', null);
      }
      const { data: priceData, error: priceError } = await priceQuery.single();

      if (priceError || !priceData) {
        return paymentResponse.error(
          res,
          `No price configured for driver license type "${license_type}"${normDuration ? ` / duration "${normDuration}"` : ''}`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
      renewalAmount = nairaToKobo(Number(priceData.price));
      deliveryFee = 0;
      amount = renewalAmount;
      logDebug('[Payment Init] Driver license payment amount', {
        licenseType: license_type,
        duration: normDuration,
        amountNaira: priceData.price
      });
    } else {
      // Renewal: price determined by selected payment schedule items
      const validation = await validateRenewalItemsSelection(payment_schedule_id);
      if (!validation.valid) {
        return paymentResponse.error(res, validation.error, HTTP_STATUS.BAD_REQUEST);
      }

      renewalAmount = validation.total;
      deliveryFee = stateValidation.delivery_fee;
      amount = renewalAmount + deliveryFee;
    }
    
    logDebug('[Payment Init] Amount breakdown', {
      renewalAmount_naira: renewalAmount / 100,
      deliveryFee_naira: deliveryFee / 100,
      total_naira: amount / 100
    });

    // Car required for renewal and plate number; optional (null) for driver license
    const supabaseAdmin = getSupabaseAdmin();
    let car = null;
    if (!isDriverLicensePayment) {
      if (!car_slug) {
        return paymentResponse.error(res, 'car_slug is required for this payment type', HTTP_STATUS.BAD_REQUEST);
      }
      const { data: carRow, error: carError } = await supabaseAdmin
        .from('cars')
        .select('id, slug, vehicle_make, vehicle_model, registration_no, expiry_date, status, user_id')
        .eq('slug', car_slug)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();
      if (carError || !carRow) {
        return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
      }
      car = carRow;
    }

    // Abandon stale pending transactions: for car payments by car_id; for driver license by user + type
    if (car) {
      const { data: staleTxns } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference')
        .eq('car_id', car.id)
        .eq('user_id', userId)
        .eq('status', PAYMENT_STATUS.PENDING);
      if (staleTxns && staleTxns.length > 0) {
        await supabaseAdmin
          .from('payment_transactions')
          .update({ status: PAYMENT_STATUS.ABANDONED, updated_at: new Date().toISOString() })
          .eq('car_id', car.id)
          .eq('user_id', userId)
          .eq('status', PAYMENT_STATUS.PENDING);
        logInfo('[Payment Init] Abandoned stale pending transactions', { carId: car.id, count: staleTxns.length });
      }
    } else if (isDriverLicensePayment) {
      const { data: staleTxns } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference')
        .eq('user_id', userId)
        .eq('payment_type', PAYMENT_TYPE.DRIVER_LICENSE)
        .is('car_id', null)
        .eq('status', PAYMENT_STATUS.PENDING);
      if (staleTxns && staleTxns.length > 0) {
        await supabaseAdmin
          .from('payment_transactions')
          .update({ status: PAYMENT_STATUS.ABANDONED, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('payment_type', PAYMENT_TYPE.DRIVER_LICENSE)
          .is('car_id', null)
          .eq('status', PAYMENT_STATUS.PENDING);
        logInfo('[Payment Init] Abandoned stale driver license pending transactions', { count: staleTxns.length });
      }
    }

    const transaction = await createTransaction({
      userId,
      carId: car?.id ?? null,
      amount,
      paymentType: payment_type,
      paymentGateway: payment_gateway,
      metadata: buildPaymentMetadata({
        carId: car?.id ?? null,
        carSlug: car_slug ?? null,
        paymentType: payment_type,
        renewalMonths: renewal_months,
        paymentScheduleId: payment_schedule_id,
        renewalAmount,
        deliveryFee,
        deliveryDetails: hasDeliveryDetails ? deliveryData : null,
        userId,
        paymentGateway: payment_gateway,
        plateType: isPlatePayment ? plate_type : null,
        subType: isPlatePayment ? (sub_type || null) : null,
        licenseType: isDriverLicensePayment ? String(license_type).toLowerCase() : null,
        licenseDuration: isDriverLicensePayment ? (duration || null) : null
      })
    });
    
    const initStartTime = Date.now();
    paymentMetrics.trackInitialization({ gateway: payment_gateway, amount });
    
    let gateway;
    try {
      gateway = GatewayFactory.getGateway(payment_gateway);
      logInfo('[Payment Init] Initializing with gateway', {
        gateway: payment_gateway,
        reference: transaction.reference
      });
    } catch (gatewayError) {
      logError('[Payment Init] Failed to get gateway adapter', {
        error: gatewayError.message,
        gateway: payment_gateway
      });
      throw gatewayError;
    }
    
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
        hasDeliveryDetails,
        plateType: isPlatePayment ? plate_type : null,
        subType: isPlatePayment ? (sub_type || null) : null,
        licenseType: isDriverLicensePayment ? String(license_type).toLowerCase() : null,
        licenseDuration: isDriverLicensePayment ? (duration || null) : null
      });
    } catch (initError) {
      logError('[Payment Init] Gateway initialization failed', {
        gateway: payment_gateway,
        error: initError.message,
        code: initError.code,
        reference: transaction.reference
      });
      throw initError;
    }
    
    if (payment_gateway === PAYMENT_GATEWAY.MONICREDIT) {
      await updateTransactionWithMonicreditInit(transaction.reference, gatewayResult);
    } else {
      await updateTransactionWithPaystackInit(transaction.reference, gatewayResult);
    }
    
    paymentMetrics.trackInitialization({
      gateway: payment_gateway,
      amount,
      processingTime: Date.now() - initStartTime
    });
    
    const responseData = {
      reference: transaction.reference,
      transaction_id: transaction.id,
      gateway: payment_gateway
    };
    
    if (payment_gateway === PAYMENT_GATEWAY.MONICREDIT) {
      // Amounts are stored in kobo internally; send naira to the frontend
      Object.assign(responseData, {
        order_id: gatewayResult.order_id,
        transaction_id_monicredit: gatewayResult.transaction_id,
        customer: gatewayResult.customer,
        account_number: gatewayResult.account_number,
        bank_name: gatewayResult.bank_name,
        account_name: gatewayResult.account_name,
        payment_url: gatewayResult.authorization_url || null,
        checkout_url: gatewayResult.authorization_url || null,
        total_amount: gatewayResult.total_amount ? gatewayResult.total_amount / 100 : 0,
        amount: amount / 100,
        expires_at: gatewayResult.expires_at
      });
    } else {
      // Paystack expects kobo — do not convert
      Object.assign(responseData, {
        authorization_url: gatewayResult.authorization_url,
        access_code: gatewayResult.access_code,
        amount
      });
    }

    if (idempotencyKey) {
      await storeIdempotencyResponse(idempotencyKey, userId, transaction.id, responseData, false);
    }

    await logPaymentAudit({
      eventType: 'init',
      transactionId: transaction.id,
      reference: transaction.reference,
      userId,
      paymentGateway: payment_gateway,
      amountKobo: amount,
      statusAfter: PAYMENT_STATUS.PENDING,
      metadata: { gateway: payment_gateway },
      ipAddress: req.ip || req.connection?.remoteAddress,
    });
    
    return paymentResponse.success(res, responseData, SUCCESS_MESSAGES.PAYMENT_INITIALIZED);
    
  } catch (error) {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
    if (idempotencyKey && req.user?.id) {
      await storeIdempotencyResponse(idempotencyKey, req.user.id, null, {
        error: error.message,
        statusCode: error.statusCode || 500
      }, true);
    }

    logError('Initialize payment error', {
      error: error.message,
      code: error.code,
      gateway: req.body?.payment_gateway || 'unknown',
      userId: req.user?.id,
      carSlug: req.body?.car_slug
    });
    
    let errorType = 'other';
    if (error.code === 'REQUEST_TIMEOUT' || error.name === 'AbortError') errorType = 'timeout';
    else if (error.code === 'REQUEST_FAILED' || error.message.includes('fetch')) errorType = 'network';
    else if (error.code === 'API_ERROR' || error.statusCode >= 500) errorType = 'api';
    else if (error.code === 'VALIDATION_ERROR' || error.code === 'CONFIG_ERROR') errorType = 'validation';
    
    paymentMetrics.trackFailure({
      gateway: req.body?.payment_gateway || 'unknown',
      amount: req.body?.amount || 0,
      errorType
    });
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof PaystackError) {
      return paymentResponse.error(res, isProduction ? getUserFriendlyMessage(error) : error.message, error.statusCode || 500);
    }
    if (error instanceof MonicreditError) {
      logError('[Payment Init] MonicreditError details', {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode
      });
      return paymentResponse.error(res, isProduction ? getUserFriendlyMessage(error) : error.message, error.statusCode || 500);
    }
    if (error instanceof TransactionError) {
      return paymentResponse.error(res, isProduction ? getUserFriendlyMessage(error) : error.message, error.statusCode || 500);
    }
    if (error instanceof GatewayError) {
      return paymentResponse.error(res, isProduction ? getUserFriendlyMessage(error) : error.message, error.statusCode || 500);
    }
    
    const errorMessage = isProduction 
      ? 'Failed to initialize payment' 
      : `${error.message || 'Unknown error'} (${error.name || 'Error'})`;
    
    return paymentResponse.serverError(res, errorMessage);
  }
};
