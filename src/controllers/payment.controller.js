import { getSupabaseAdmin, getSupabaseUser } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';

// Payment responses use 'status' instead of 'success' for frontend compatibility
const paymentResponse = {
  success: (res, data = null, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({ status: true, message, data });
  },
  created: (res, data = null, message = 'Created successfully') => {
    return res.status(201).json({ status: true, message, data });
  },
  error: (res, message = 'An error occurred', statusCode = 400, errors = null) => {
    const errorResponse = { status: false, message };
    if (errors) errorResponse.errors = errors;
    return res.status(statusCode).json(errorResponse);
  },
  notFound: (res, message = 'Not found') => paymentResponse.error(res, message, 404),
  forbidden: (res, message = 'Forbidden') => paymentResponse.error(res, message, 403),
  serverError: (res, message = 'Internal server error') => paymentResponse.error(res, message, 500)
};
import {
  initializeTransaction as paystackInitialize,
  verifyTransaction as paystackVerify,
  verifyWebhookSignature,
  parseWebhookEvent,
  PaystackError
} from '../services/payment/paystack.service.js';
import {
  createTransaction,
  getTransactionByReference,
  getTransactionById,
  getTransactionByPaystackReference,
  getTransactionByWebhookEventId,
  updateTransactionWithPaystackInit,
  updateTransactionStatus,
  updateTransactionWebhookEventId,
  processPaymentSuccess,
  getUserTransactions,
  getCarTransactions,
  markTransactionAbandoned,
  TransactionError
} from '../services/payment/transaction.service.js';
import {
  getOrderById,
  getOrderByNumber,
  getOrderByTransactionId,
  getUserOrders,
  OrderError
} from '../services/payment/order.service.js';
import {
  createSubscription,
  getSubscriptionById,
  getUserSubscriptions,
  hasActiveSubscription,
  activateSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  SubscriptionError
} from '../services/payment/subscription.service.js';
import { createInAppNotification } from '../services/notification.service.js';
import { sendPaymentSuccessEmail, sendPaymentFailedEmail } from '../services/email/paymentEmail.service.js';
import {
  validatePaymentAmount,
  buildPaymentMetadata,
  formatAmount
} from '../utils/paymentHelpers.js';
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  ORDER_TYPE,
  PAYSTACK_EVENTS,
  HTTP_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  PAYMENT_LIMITS
} from '../constants/payment.constants.js';
import {
  getRenewalItems as getRenewalItemsFromDb,
  validateRenewalItemsSelection
} from '../services/payment/renewalItems.service.js';
import {
  getAllStates,
  getLGAsByState,
  getDeliveryFee,
  resolveStateAndLGA
} from '../services/location.service.js';

export const getRenewalItems = async (req, res) => {
  try {
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

export const getPaymentHeads = async (req, res) => {
  try {
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

export const getStates = async (req, res) => {
  try {
    const states = await getAllStates();
    
    const transformedStates = states.map((state) => ({
      id: state.id,  // Use actual database ID, not array index
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

export const getLGAs = async (req, res) => {
  try {
    const { stateCode } = req.params;
    
    const lgas = await getLGAsByState(stateCode);
    
    if (lgas.length === 0) {
      return paymentResponse.notFound(res, 'Invalid state code or state not found');
    }
    
    // Transform to match frontend expectations
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

export const initializePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { 
      car_slug, 
      payment_schedule_id = [], 
      renewal_months = 12, 
      payment_type = PAYMENT_TYPE.RENEWAL_MANUAL,
      delivery_details,
      meta_data
    } = req.body;
    
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
      metadata: buildPaymentMetadata({
        carId: car.id,
        carSlug: car_slug,
        paymentType: payment_type,
        renewalMonths: renewal_months,
        paymentScheduleId: payment_schedule_id,
        renewalAmount,
        deliveryFee,
        deliveryDetails: hasDeliveryDetails ? deliveryData : null,
        userId
      })
    });
    
    // Build callback URL
    // SECURITY: Only use environment variables - frontend cannot control redirect URL
    // This prevents phishing attacks and payment confirmation bypass
    const callbackUrl = process.env.PAYMENT_CALLBACK_URL || 
      `${process.env.FRONTEND_URL}/payment/paystack/callback`;
    
    // Initialize with Paystack
    const paystackResult = await paystackInitialize({
      email: userEmail,
      amount,
      reference: transaction.reference,
      callback_url: callbackUrl,
      metadata: {
        transaction_id: transaction.id,
        car_id: car.id,
        car_slug: car_slug,
        user_id: userId,
        renewal_months,
        payment_type,
        payment_schedule_id,
        renewal_amount: renewalAmount,
        delivery_fee: deliveryFee,
        delivery_details: hasDeliveryDetails ? deliveryData : null,
        custom_fields: [
          {
            display_name: 'Vehicle',
            variable_name: 'vehicle',
            value: `${car.vehicle_make} ${car.vehicle_model}`
          },
          {
            display_name: 'Registration',
            variable_name: 'registration',
            value: car.registration_no || 'N/A'
          },
          ...(hasDeliveryDetails
            ? [
                {
                  display_name: 'Delivery State',
                  variable_name: 'delivery_state',
                  value: deliveryData.state
                },
                {
                  display_name: 'Delivery LGA',
                  variable_name: 'delivery_lga',
                  value: deliveryData.lga
                }
              ]
            : [])
        ]
      }
    });
    
    await updateTransactionWithPaystackInit(transaction.reference, paystackResult);
    
    return paymentResponse.success(res, {
      reference: transaction.reference,
      transaction_id: transaction.id,
      authorization_url: paystackResult.authorization_url,
      access_code: paystackResult.access_code,
      amount: amount
    }, SUCCESS_MESSAGES.PAYMENT_INITIALIZED);
    
  } catch (error) {
    logError('Initialize payment error', error);
    
    if (error instanceof PaystackError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    if (error instanceof TransactionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to initialize payment');
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    console.log('[Verify Payment] Starting verification:', {
      reference,
      userId,
      timestamp: new Date().toISOString()
    });
    
    // Get transaction from database - try both our reference and Paystack reference
    let transaction = await getTransactionByReference(reference);
    
    // If not found by our reference, try Paystack reference
    if (!transaction) {
      console.log('[Verify Payment] Transaction not found by our reference, trying Paystack reference lookup');
      transaction = await getTransactionByPaystackReference(reference);
    }
    
    if (!transaction) {
      logError('Transaction not found for verification', {
        reference,
        userId,
        message: 'Transaction not found in database. Payment may not have been initialized properly.'
      });
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    console.log('[Verify Payment] Found transaction:', {
      id: transaction.id,
      reference: transaction.reference,
      paystackReference: transaction.paystack_reference,
      status: transaction.status,
      amount: transaction.amount,
      carId: transaction.car_id,
      userId: transaction.user_id,
      createdAt: transaction.created_at
    });
    
    if (transaction.user_id !== userId) {
      logError('Unauthorized payment verification attempt', {
        reference,
        transactionUserId: transaction.user_id,
        requestUserId: userId,
        transactionCarId: transaction.car_id
      });
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    // SECURITY: Parse metadata with proper error handling
    let metaData = {};
    try {
      metaData = typeof transaction.metadata === 'string' 
        ? JSON.parse(transaction.metadata) 
        : (transaction.metadata || {});
    } catch (e) {
      logError('CRITICAL: Failed to parse transaction metadata', {
        error: e.message,
        transactionId: transaction.id,
        reference: transaction.reference
      });
      return paymentResponse.error(res, 
        'Payment data corrupted. Please contact support with reference: ' + transaction.reference,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

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
          console.warn('[Verify Payment] Failed to get car slug for successful transaction:', carError);
        }
      }
      
      console.log('[Verify Payment] Payment already successful, returning:', {
        transactionId: transaction.id,
        carId: transaction.car_id,
        carSlug: carSlug,
        reference: transaction.reference
      });
      
      return paymentResponse.success(res, {
        status: 'success',
        message: 'Payment verified successfully',
        reference: transaction.reference,
        transaction_id: transaction.id,
        amount: transaction.amount,
        paid_at: transaction.paid_at,
        car_id: transaction.car_id, // Use car_id from the actual transaction
        car_slug: carSlug
      }, SUCCESS_MESSAGES.PAYMENT_VERIFIED);
    }
    
    let paystackResult;
    let verifyReference = transaction.reference || reference;
    
    try {
      console.log('[Verify Payment] Verifying with Paystack using reference:', verifyReference);
      paystackResult = await paystackVerify(verifyReference);
    } catch (verifyError) {
      if (transaction.paystack_reference && transaction.paystack_reference !== verifyReference) {
        console.log('[Verify Payment] First verification failed, trying Paystack reference:', transaction.paystack_reference);
        try {
          verifyReference = transaction.paystack_reference;
          paystackResult = await paystackVerify(verifyReference);
        } catch (secondError) {
          logError('Paystack verification failed with both references', {
            ourReference: transaction.reference,
            paystackReference: transaction.paystack_reference,
            firstError: verifyError.message,
            secondError: secondError.message
          });
          throw verifyError; // Throw original error
        }
      } else {
        throw verifyError;
      }
    }
    
    console.log('[Verify Payment] Paystack verification result:', {
      status: paystackResult.status,
      amount: paystackResult.amount,
      reference: paystackResult.reference,
      paidAt: paystackResult.paid_at,
      usedReference: verifyReference
    });
    
    if (paystackResult.status === 'success') {
      // Update paystack_reference if it's different
      if (paystackResult.reference && paystackResult.reference !== transaction.paystack_reference) {
        console.log('[Verify Payment] Updating Paystack reference:', paystackResult.reference);
        await updateTransactionStatus(transaction.reference, {
          status: transaction.status, // Keep current status
          channel: null,
          authorization_code: null,
          paid_at: null
        });
        // Update paystack_reference separately if needed
        const supabaseAdmin = getSupabaseAdmin();
        await supabaseAdmin
          .from('payment_transactions')
          .update({ paystack_reference: paystackResult.reference })
          .eq('id', transaction.id);
      }
      
      if (paystackResult.amount !== transaction.amount || paystackResult.currency !== transaction.currency) {
        logError('Verify payment mismatch', {
          reference,
          expectedAmount: transaction.amount,
          actualAmount: paystackResult.amount,
          expectedCurrency: transaction.currency,
          actualCurrency: paystackResult.currency
        });
        return paymentResponse.error(res, 'Payment amount verification failed', HTTP_STATUS.CONFLICT);
      }

      // If payment is successful on Paystack but still pending in our DB,
      // process it manually (webhook may be delayed or failed)
      if (transaction.status === PAYMENT_STATUS.PENDING) {
        console.log('[Verify Payment] Payment successful on Paystack but pending in DB, processing manually...');
        try {
          // Process payment using the same logic as webhook handler
          // Create a webhook-like data structure from Paystack response
          const webhookData = {
            reference: paystackResult.reference,
            amount: paystackResult.amount,
            currency: paystackResult.currency,
            channel: paystackResult.channel,
            paid_at: paystackResult.paid_at,
            authorization: paystackResult.authorization,
            metadata: paystackResult.metadata || {}
          };
          
          // Process the payment (this will update status, create order, etc.)
          const processResult = await handleChargeSuccess(webhookData, null); // No eventId for manual verification
          
          // Check if processing was successful
          if (!processResult.success || processResult.error) {
            // Processing failed, but payment is confirmed on Paystack
            logError('Payment processing failed during manual verification', {
              error: processResult.error,
              reference,
              transactionId: processResult.transaction?.id
            });
            
            // Try to get the current transaction status
            const currentTransaction = await getTransactionByReference(reference);
            const currentOrder = currentTransaction ? await getOrderByTransactionId(currentTransaction.id).catch(() => null) : null;
            
            return paymentResponse.success(res, {
              status: 'success',
              message: processResult.error 
                ? `Payment verified on Paystack but processing failed: ${processResult.error}. Please contact support.`
                : 'Payment verified on Paystack but processing encountered an error. Please contact support.',
              reference: currentTransaction?.reference || transaction.reference,
              transaction_id: currentTransaction?.id || transaction.id,
              amount: currentTransaction?.amount || transaction.amount,
              paid_at: currentTransaction?.paid_at || paystackResult.paid_at,
              car_id: currentTransaction?.car_id || transaction.car_id,
              car_slug: metaData?.carSlug,
              order_id: currentOrder?.id || null,
              order_number: currentOrder?.order_number || null,
              processed: currentTransaction?.status === PAYMENT_STATUS.SUCCESSFUL,
              warning: 'Payment confirmed but processing may have failed',
              error: processResult.error
            }, 'Payment verified but processing error occurred');
          }
          
          // Processing was successful
          const updatedTransaction = processResult.transaction || await getTransactionByReference(reference);
          const createdOrder = processResult.order || await getOrderByTransactionId(updatedTransaction.id).catch(() => null);
          
          // Try to send notifications (non-blocking)
          try {
            await processSuccessfulPayment(updatedTransaction, webhookData, createdOrder);
          } catch (notifyError) {
            // Log but don't fail - payment is already processed
            logError('Failed to send notifications during manual verification', {
              error: notifyError,
              reference,
              transactionId: updatedTransaction.id
            });
          }
          
          // Get car slug if not in metadata
          const supabaseAdmin = getSupabaseAdmin();
          let carSlug = metaData?.carSlug;
          if (!carSlug && updatedTransaction.car_id) {
            try {
              const { data: carData } = await supabaseAdmin
                .from('cars')
                .select('slug')
                .eq('id', updatedTransaction.car_id)
                .single();
              carSlug = carData?.slug;
            } catch (carError) {
              console.warn('[Verify Payment] Failed to get car slug:', carError);
            }
          }
          
          console.log('[Verify Payment] Returning verification response:', {
            transactionId: updatedTransaction.id,
            carId: updatedTransaction.car_id,
            carSlug: carSlug,
            orderId: createdOrder?.id,
            orderNumber: createdOrder?.order_number,
            reference: updatedTransaction.reference
          });
          
          return paymentResponse.success(res, {
            status: 'success',
            message: 'Payment verified and processed successfully',
            reference: updatedTransaction.reference,
            transaction_id: updatedTransaction.id,
            amount: updatedTransaction.amount,
            paid_at: updatedTransaction.paid_at || paystackResult.paid_at,
            car_id: updatedTransaction.car_id, // Use car_id from the actual transaction
            car_slug: carSlug,
            order_id: createdOrder?.id || null,
            order_number: createdOrder?.order_number || null,
            processed: true // Indicates we processed it manually
          }, SUCCESS_MESSAGES.PAYMENT_VERIFIED);
        } catch (processError) {
          // Log the full error details for debugging
          logError('Failed to process payment during verification', {
            error: processError,
            errorMessage: processError.message,
            errorStack: processError.stack,
            reference,
            transactionId: transaction.id,
            paystackStatus: paystackResult.status,
            paystackAmount: paystackResult.amount,
            transactionAmount: transaction.amount
          });
          
          // Try to get the updated transaction status (might have been partially processed)
          let updatedTransaction = null;
          let createdOrder = null;
          try {
            updatedTransaction = await getTransactionByReference(reference);
            if (updatedTransaction) {
              // Try to get order if it was created
              try {
                createdOrder = await getOrderByTransactionId(updatedTransaction.id);
              } catch (orderError) {
                logError('Failed to get order after processing error', {
                  error: orderError,
                  transactionId: updatedTransaction.id
                });
              }
            }
          } catch (txError) {
            logError('Failed to get updated transaction after processing error', {
              error: txError,
              reference
            });
            // Use original transaction if we can't get updated one
            updatedTransaction = transaction;
          }
          
          // Determine if payment was actually processed despite the error
          const wasProcessed = updatedTransaction?.status === PAYMENT_STATUS.SUCCESSFUL;
          const hasOrder = !!createdOrder;
          
          // Return success with detailed information
          return paymentResponse.success(res, {
            status: 'success',
            message: wasProcessed 
              ? 'Payment verified and processed successfully, but some operations may have failed. Please check your order status.'
              : 'Payment verified on Paystack but processing encountered an error. Please contact support with your reference number.',
            reference: updatedTransaction?.reference || transaction.reference,
            transaction_id: updatedTransaction?.id || transaction.id,
            amount: updatedTransaction?.amount || transaction.amount,
            paid_at: updatedTransaction?.paid_at || paystackResult.paid_at,
            car_id: updatedTransaction?.car_id || transaction.car_id,
            car_slug: metaData?.carSlug,
            order_id: createdOrder?.id || null,
            order_number: createdOrder?.order_number || null,
            processed: wasProcessed,
            warning: wasProcessed 
              ? 'Payment processed but some notifications may have failed'
              : 'Payment confirmed on Paystack but processing failed. Please contact support.',
            error_details: process.env.NODE_ENV === 'development' ? {
              message: processError.message,
              type: processError.constructor.name
            } : undefined
          }, wasProcessed 
            ? 'Payment verified but some operations may have failed'
            : 'Payment verified but processing error occurred');
        }
      }

      // Already processed, return success
      return paymentResponse.success(res, {
        status: 'success',
        message: 'Payment verified successfully',
        reference: transaction.reference,
        transaction_id: transaction.id,
        amount: transaction.amount,
        paid_at: transaction.paid_at || paystackResult.paid_at,
        car_id: transaction.car_id,
        car_slug: metaData?.carSlug
      }, SUCCESS_MESSAGES.PAYMENT_VERIFIED);
    }

    return paymentResponse.success(res, {
      status: 'failed',
      message: ERROR_MESSAGES.PAYMENT_FAILED,
      reference: transaction.reference,
      transaction_id: transaction.id,
      amount: transaction.amount
    }, ERROR_MESSAGES.PAYMENT_FAILED);
    
  } catch (error) {
    logError('Verify payment error', error);
    
    if (error instanceof PaystackError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to verify payment');
  }
};

/**
 * Get single transaction by reference
 * Lightweight endpoint - returns transaction from database only (no Paystack API call)
 * 
 * GET /api/payments/:reference
 */
export const getTransaction = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    // Get transaction from database
    const transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    // Verify user owns this transaction
    if (transaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    // Parse metadata safely
    let metaData = {};
    try {
      metaData = typeof transaction.metadata === 'string' 
        ? JSON.parse(transaction.metadata) 
        : (transaction.metadata || {});
    } catch (e) {
      // If metadata parsing fails, continue with empty object
      logError('Failed to parse transaction metadata in getTransaction', {
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
    
    if (error instanceof TransactionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to retrieve transaction');
  }
};

/**
 * Get transaction status (lightweight)
 * Returns only status information without full transaction details
 * 
 * GET /api/payments/:reference/status
 */
export const getTransactionStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    // Get transaction from database
    const transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    // Verify user owns this transaction
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
    
    if (error instanceof TransactionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to retrieve transaction status');
  }
};

/**
 * Cancel/abandon a payment
 * Marks payment as abandoned when user closes payment page
 * 
 * PUT /api/payments/:reference/cancel
 * Body: { reason? }
 */
export const cancelPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    const { reason } = req.body;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    // Get transaction from database
    const transaction = await getTransactionByReference(reference);
    
    if (!transaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    // Verify user owns this transaction
    if (transaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    // Only allow canceling pending payments
    if (transaction.status !== PAYMENT_STATUS.PENDING) {
      return paymentResponse.error(
        res,
        `Cannot cancel payment with status: ${transaction.status}. Only pending payments can be cancelled.`,
        HTTP_STATUS.CONFLICT
      );
    }
    
    // Mark as abandoned
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
 * Retry a failed or abandoned payment
 * Creates a new transaction with same parameters as original
 * 
 * POST /api/payments/:reference/retry
 */
export const retryPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return paymentResponse.error(res, 'Payment reference is required', HTTP_STATUS.BAD_REQUEST);
    }
    
    // Get original transaction
    const originalTransaction = await getTransactionByReference(reference);
    
    if (!originalTransaction) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    // Verify user owns this transaction
    if (originalTransaction.user_id !== userId) {
      return paymentResponse.forbidden(res, ERROR_MESSAGES.UNAUTHORIZED);
    }
    
    // Only allow retrying failed or abandoned payments
    if (originalTransaction.status === PAYMENT_STATUS.SUCCESSFUL) {
      return paymentResponse.error(
        res,
        'Cannot retry a successful payment',
        HTTP_STATUS.CONFLICT
      );
    }
    
    if (originalTransaction.status === PAYMENT_STATUS.REFUNDED) {
      return paymentResponse.error(
        res,
        'Cannot retry a refunded payment',
        HTTP_STATUS.CONFLICT
      );
    }
    
    // Parse metadata from original transaction
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
    
    // Create new transaction with same parameters
    const newTransaction = await createTransaction({
      userId,
      carId: originalTransaction.car_id,
      amount: originalTransaction.amount,
      paymentType: originalTransaction.payment_type,
      metadata: {
        ...metaData,
        retry_of: reference,
        retry_at: new Date().toISOString()
      }
    });
    
    // Get user email for Paystack initialization
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();
    
    if (!profile?.email) {
      return paymentResponse.error(res, 'User email not found', HTTP_STATUS.BAD_REQUEST);
    }
    
    // Initialize with Paystack
    const callbackUrl = process.env.PAYMENT_CALLBACK_URL || 
      `${process.env.FRONTEND_URL}/payment/paystack/callback`;
    
    const paystackResult = await paystackInitialize({
      email: profile.email,
      amount: newTransaction.amount,
      reference: newTransaction.reference,
      callback_url: callbackUrl,
      metadata: {
        transaction_id: newTransaction.id,
        car_id: originalTransaction.car_id,
        car_slug: metaData?.carSlug,
        user_id: userId,
        retry_of: reference,
        renewal_months: metaData?.renewal_months || 12,
        payment_type: originalTransaction.payment_type,
        payment_schedule_id: metaData?.paymentScheduleId || metaData?.payment_schedule_id || [],
        renewal_amount: metaData?.renewal_amount || newTransaction.amount,
        delivery_fee: metaData?.delivery_fee || 0,
        delivery_details: metaData?.delivery_details || null
      }
    });
    
    // Update transaction with Paystack data
    await updateTransactionWithPaystackInit(newTransaction.reference, paystackResult);
    
    return paymentResponse.created(res, {
      reference: newTransaction.reference,
      transaction_id: newTransaction.id,
      authorization_url: paystackResult.authorization_url,
      access_code: paystackResult.access_code,
      amount: newTransaction.amount,
      original_reference: reference
    }, 'Payment retry initialized successfully');
    
  } catch (error) {
    logError('Retry payment error', error);
    
    if (error instanceof PaystackError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    if (error instanceof TransactionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to retry payment');
  }
};

/**
 * Get user's payment history
 * 
 * GET /api/payments/history
 * Query: page, limit, status
 */
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

/**
 * Check for existing payments on payment schedules
 * Prevents duplicate payments for already paid schedules
 * 
 * POST /api/payment/check-existing
 * Body: { car_slug, payment_schedule_ids }
 */
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
    
    // Get car by slug
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
    
    // Check for successful transactions with these payment schedule IDs
    const { data: transactions, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .select('*')
      .eq('car_id', car.id)
      .eq('user_id', userId)
      .eq('status', PAYMENT_STATUS.SUCCESSFUL);
    
    if (txError) {
      logError('Check existing payments DB error', txError);
      return paymentResponse.serverError(res, 'Failed to check existing payments');
    }
    
    // Extract payment schedule IDs that have been successfully paid
    const existingPayments = [];
    
    if (transactions && transactions.length > 0) {
      for (const tx of transactions) {
        try {
          if (tx.metadata) {
            // Handle metadata that could be JSON string or object
            const metadata = typeof tx.metadata === 'string' ? JSON.parse(tx.metadata) : tx.metadata;
            
            if (metadata && metadata.paymentScheduleId) {
              const scheduleIds = Array.isArray(metadata.paymentScheduleId) 
                ? metadata.paymentScheduleId 
                : [metadata.paymentScheduleId];
              
              for (const scheduleId of scheduleIds) {
                // Ensure both are same type for comparison
                const scheduleIdStr = String(scheduleId);
                const compareIds = payment_schedule_ids.map(id => String(id));
                
                if (compareIds.includes(scheduleIdStr)) {
                  existingPayments.push({
                    payment_schedule_id: scheduleId,
                    payment_head_name: metadata.payment_head_name || 'Renewal',
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

/**
 * Get payments for a specific car
 * 
 * GET /api/payments/car/:slug
 */
export const getCarPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { slug } = req.params;
    
    // Get car by slug
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

/**
 * Get payment receipt for a car (by ID or slug)
 * Returns the latest successful payment transaction with order details
 * 
 * GET /api/payment/car-receipt/:identifier
 */
export const getCarPaymentReceipt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { identifier } = req.params; // Can be car ID, slug, or order number
    
    console.log('[Receipt] Receipt request received:', {
      identifier,
      userId,
      timestamp: new Date().toISOString()
    });
    
    const supabaseAdmin = getSupabaseAdmin();
    
    // Try to find car by ID first, then by slug, then by order number
    let car;
    let transaction = null;
    const isNumeric = /^\d+$/.test(identifier);
    
    if (isNumeric) {
      // First, try as order number
      try {
        const order = await getOrderByNumber(identifier);
        if (order && order.user_id === userId && order.transaction_id) {
          // Get transaction from order (transaction_id is a number, not a reference)
          transaction = await getTransactionById(order.transaction_id);
          if (transaction && transaction.car_id) {
            // Get car from transaction
            const { data: carFromOrder, error: carError } = await supabaseAdmin
              .from('cars')
              .select('id, slug')
              .eq('id', transaction.car_id)
              .eq('user_id', userId)
              .is('deleted_at', null)
              .single();
            
            if (!carError && carFromOrder) {
              car = carFromOrder;
            }
          }
        }
      } catch (orderError) {
        // Not an order number, continue to try as car ID
      }
      
      // If not found by order number, try as car ID
      if (!car) {
        const { data: carById, error: carByIdError } = await supabaseAdmin
          .from('cars')
          .select('id, slug')
          .eq('id', parseInt(identifier))
          .eq('user_id', userId)
          .is('deleted_at', null)
          .single();
        
        if (!carByIdError && carById) {
          car = carById;
        }
      }
    }
    
    // If not found by ID or order number, try by slug
    if (!car) {
      const { data: carBySlug, error: carBySlugError } = await supabaseAdmin
        .from('cars')
        .select('id, slug')
        .eq('slug', identifier)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();
      
      if (carBySlugError || !carBySlug) {
        return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
      }
      
      car = carBySlug;
    }
    
    // If we already have a transaction from order lookup, use it
    // Otherwise, get the latest successful transaction for this car
    if (!transaction) {
      console.log('[Receipt] Looking for successful transactions:', {
        carId: car.id,
        userId,
        status: PAYMENT_STATUS.SUCCESSFUL
      });
      
      const { data: transactions, error: txError } = await supabaseAdmin
        .from('payment_transactions')
        .select('*')
        .eq('car_id', car.id)
        .eq('user_id', userId)
        .eq('status', PAYMENT_STATUS.SUCCESSFUL)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (txError) {
        logError('Get car payment receipt error', { error: txError, carId: car.id });
        return paymentResponse.serverError(res, 'Failed to retrieve payment receipt');
      }
      
      console.log('[Receipt] Successful transactions found:', {
        count: transactions?.length || 0,
        transactions: transactions?.map(tx => ({
          id: tx.id,
          reference: tx.reference,
          status: tx.status,
          amount: tx.amount,
          created_at: tx.created_at
        })) || []
      });
      
      if (transactions && transactions.length > 0) {
        transaction = transactions[0];
        console.log('[Receipt] Using transaction:', {
          id: transaction.id,
          reference: transaction.reference,
          status: transaction.status
        });
      }
    }
    
    if (!transaction) {
      // Check for pending transactions (payment might be successful but webhook not processed)
      const { data: pendingTransactions } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, status, amount, created_at, paystack_reference')
        .eq('car_id', car.id)
        .eq('user_id', userId)
        .eq('status', PAYMENT_STATUS.PENDING)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (pendingTransactions && pendingTransactions.length > 0) {
        const pendingTx = pendingTransactions[0];
        
        // Try to verify the payment automatically if it's pending
        // This helps when webhook is delayed or failed
        try {
          console.log('[Receipt] Attempting to auto-verify pending payment:', {
            transactionId: pendingTx.id,
            ourReference: pendingTx.reference,
            paystackReference: pendingTx.paystack_reference,
            carId: pendingTx.car_id,
            amount: pendingTx.amount,
            createdAt: pendingTx.created_at
          });
          
          // Try our reference first, then Paystack reference
          let paystackResult;
          let verifyRef = pendingTx.paystack_reference || pendingTx.reference;
          
          console.log('[Receipt] Verifying with Paystack using reference:', verifyRef);
          
          try {
            paystackResult = await paystackVerify(verifyRef);
            console.log('[Receipt] Paystack verification successful:', {
              status: paystackResult.status,
              amount: paystackResult.amount,
              reference: paystackResult.reference,
              paid_at: paystackResult.paid_at
            });
          } catch (verifyError) {
            console.error('[Receipt] First verification failed:', {
              error: verifyError.message,
              reference: verifyRef
            });
            // If Paystack reference failed and we have a different reference, try that
            if (pendingTx.paystack_reference && pendingTx.paystack_reference !== pendingTx.reference) {
              console.log('[Receipt] Trying alternative reference:', pendingTx.reference);
              verifyRef = pendingTx.reference;
              try {
                paystackResult = await paystackVerify(verifyRef);
                console.log('[Receipt] Alternative verification successful:', {
                  status: paystackResult.status,
                  reference: paystackResult.reference
                });
              } catch (secondError) {
                console.error('[Receipt] Alternative verification also failed:', secondError.message);
                throw verifyError; // Throw original error
              }
            } else {
              throw verifyError;
            }
          }
          
          if (paystackResult.status === 'success') {
            // Payment is successful on Paystack, process it manually
            console.log('[Receipt] Payment successful on Paystack, processing manually...');
            
            // Get full transaction details
            const fullPendingTx = await getTransactionByReference(pendingTx.reference);
            if (fullPendingTx) {
              // Parse metadata
              let txMetadata = {};
              try {
                txMetadata = typeof fullPendingTx.metadata === 'string' 
                  ? JSON.parse(fullPendingTx.metadata) 
                  : (fullPendingTx.metadata || {});
              } catch (e) {
                logError('Failed to parse metadata in receipt auto-verify', { error: e });
              }
              
              // Process payment
              const isSub = txMetadata.subscription_id || txMetadata.is_subscription;
              const orderType = isSub ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL;
              const paymentScheduleIds = txMetadata.paymentScheduleId || txMetadata.payment_schedule_id || txMetadata.selected_items || [];
              
              const processResult = await processPaymentSuccess({
                reference: fullPendingTx.reference,
                status: PAYMENT_STATUS.SUCCESSFUL,
                channel: paystackResult.channel,
                authorization_code: paystackResult.authorization?.authorization_code,
                paid_at: paystackResult.paid_at,
                orderType,
                renewalMonths: txMetadata.renewal_months || 12,
                selectedItems: paymentScheduleIds,
                renewalAmount: txMetadata.renewal_amount || fullPendingTx.amount,
                deliveryFee: txMetadata.delivery_fee || 0,
                deliveryAddress: txMetadata.delivery_details?.address || null,
                deliveryState: txMetadata.delivery_details?.state || null,
                deliveryLGA: txMetadata.delivery_details?.lga || null,
                deliveryContact: txMetadata.delivery_details?.contact || null,
                metadata: txMetadata
              });
              
              // Get the updated transaction
              transaction = await getTransactionByReference(pendingTx.reference);
              
              if (transaction && transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
                console.log('[Receipt] Payment auto-verified and processed successfully');
                // Continue to return receipt below
              } else {
                // Still pending after processing attempt
                return paymentResponse.success(
                  res,
                  {
                    pending: true,
                    reference: pendingTx.reference,
                    message: 'Payment is still pending. Please verify your payment manually or wait a few moments.'
                  },
                  'Payment is still pending. If you completed the payment, please verify it manually using the reference: ' + pendingTx.reference,
                  200
                );
              }
            }
          } else {
            // Payment failed or still pending on Paystack
            return paymentResponse.success(
              res,
              {
                pending: true,
                reference: pendingTx.reference,
                message: 'Payment is still pending. If you completed the payment, please wait a few moments for processing, or verify your payment manually.'
              },
              'Payment is still pending. If you completed the payment, please wait a few moments for processing, or verify your payment manually using the reference: ' + pendingTx.reference,
              200
            );
          }
        } catch (verifyError) {
          // Auto-verification failed, return pending status
          logError('Failed to auto-verify pending payment in receipt endpoint', {
            error: verifyError,
            reference: pendingTx.reference
          });
          
          return paymentResponse.success(
            res,
            {
              pending: true,
              reference: pendingTx.reference,
              message: 'Payment is still pending. If you completed the payment, please verify it manually or wait a few moments.'
            },
            'Payment is still pending. If you completed the payment, please verify it manually using the reference: ' + pendingTx.reference,
            200
          );
        }
      }
      
      // DIAGNOSTIC: Log all transactions for this car to help debug
      console.log('[Receipt] No successful transaction found, checking all transactions for car:', car.id);
      
      const { data: allTransactions, error: allTxError } = await supabaseAdmin
        .from('payment_transactions')
        .select('id, reference, status, amount, created_at, paid_at, paystack_reference, car_id, user_id')
        .eq('car_id', car.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      
      console.log('[Receipt] All transactions query result:', {
        error: allTxError,
        count: allTransactions?.length || 0,
        transactions: allTransactions?.map(tx => ({
          id: tx.id,
          reference: tx.reference,
          paystack_reference: tx.paystack_reference,
          status: tx.status,
          amount: tx.amount,
          car_id: tx.car_id,
          user_id: tx.user_id,
          created_at: tx.created_at,
          paid_at: tx.paid_at
        })) || []
      });
      
      // Check if there are any transactions at all
      if (!allTransactions || allTransactions.length === 0) {
        logError('No transactions found for car receipt', {
          carId: car.id,
          carSlug: car.slug,
          userId,
          message: 'No payment transactions found for this car'
        });
        return paymentResponse.notFound(res, 'No payment transactions found for this car. Please make a payment first.');
      }
      
      // Check for failed transactions that might have been successful on Paystack
      const failedTransactions = allTransactions.filter(tx => tx.status === PAYMENT_STATUS.FAILED);
      if (failedTransactions.length > 0) {
        console.log('[Receipt] Found failed transactions, attempting to verify latest one:', failedTransactions[0].reference);
        
        // Try to verify the latest failed transaction
        try {
          const latestFailed = failedTransactions[0];
          console.log('[Receipt] Attempting to verify failed transaction:', {
            ourReference: latestFailed.reference,
            paystackReference: latestFailed.paystack_reference
          });
          
          // Try Paystack reference first, then our reference
          let paystackResult;
          let verifyRef = latestFailed.paystack_reference || latestFailed.reference;
          
          try {
            paystackResult = await paystackVerify(verifyRef);
          } catch (verifyError) {
            // If Paystack reference failed and we have a different reference, try that
            if (latestFailed.paystack_reference && latestFailed.paystack_reference !== latestFailed.reference) {
              console.log('[Receipt] First verification failed, trying our reference:', latestFailed.reference);
              verifyRef = latestFailed.reference;
              paystackResult = await paystackVerify(verifyRef);
            } else {
              throw verifyError;
            }
          }
          
          if (paystackResult.status === 'success') {
            console.log('[Receipt] Failed transaction is actually successful on Paystack, reprocessing...');
            
            // Get full transaction details
            const fullTx = await getTransactionByReference(latestFailed.reference);
            if (fullTx) {
              // Parse metadata
              let txMetadata = {};
              try {
                txMetadata = typeof fullTx.metadata === 'string' 
                  ? JSON.parse(fullTx.metadata) 
                  : (fullTx.metadata || {});
              } catch (e) {
                logError('Failed to parse metadata', { error: e });
              }
              
              // Process payment
              const isSub = txMetadata.subscription_id || txMetadata.is_subscription;
              const orderType = isSub ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL;
              const paymentScheduleIds = txMetadata.paymentScheduleId || txMetadata.payment_schedule_id || txMetadata.selected_items || [];
              
              await processPaymentSuccess({
                reference: fullTx.reference,
                status: PAYMENT_STATUS.SUCCESSFUL,
                channel: paystackResult.channel,
                authorization_code: paystackResult.authorization?.authorization_code,
                paid_at: paystackResult.paid_at,
                orderType,
                renewalMonths: txMetadata.renewal_months || 12,
                selectedItems: paymentScheduleIds,
                renewalAmount: txMetadata.renewal_amount || fullTx.amount,
                deliveryFee: txMetadata.delivery_fee || 0,
                deliveryAddress: txMetadata.delivery_details?.address || null,
                deliveryState: txMetadata.delivery_details?.state || null,
                deliveryLGA: txMetadata.delivery_details?.lga || null,
                deliveryContact: txMetadata.delivery_details?.contact || null,
                metadata: txMetadata
              });
              
              // Get the updated transaction and continue to return receipt
              transaction = await getTransactionByReference(latestFailed.reference);
              if (transaction && transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
                console.log('[Receipt] Successfully reprocessed failed transaction');
                // Continue to return receipt below
              }
            }
          }
        } catch (verifyError) {
          logError('Failed to verify failed transaction', {
            error: verifyError,
            reference: failedTransactions[0].reference
          });
        }
      }
      
      // If still no transaction, return detailed error
      if (!transaction) {
        logError('No successful payment found for car receipt', {
          carId: car.id,
          carSlug: car.slug,
          userId,
          availableTransactions: allTransactions || [],
          transactionStatuses: allTransactions?.map(tx => ({ 
            id: tx.id, 
            reference: tx.reference, 
            status: tx.status,
            amount: tx.amount,
            created_at: tx.created_at
          })) || [],
          message: 'No successful payments found. Available transactions: ' + JSON.stringify(allTransactions?.map(tx => ({ status: tx.status, reference: tx.reference })))
        });
        
        // Return more helpful error message
        const statusCounts = {};
        allTransactions.forEach(tx => {
          statusCounts[tx.status] = (statusCounts[tx.status] || 0) + 1;
        });
        
        return paymentResponse.notFound(res, 
          `No successful payment found for this car. Found ${allTransactions.length} transaction(s) with statuses: ${JSON.stringify(statusCounts)}. ` +
          `If you just made a payment, please wait a few moments or verify it manually.`
        );
      }
    }
    
    // Get associated order if exists (or use the one we found if we looked up by order number)
    let order = null;
    if (isNumeric) {
      // Try to get order by number first (in case identifier was an order number)
      try {
        const orderByNumber = await getOrderByNumber(identifier);
        if (orderByNumber && orderByNumber.user_id === userId) {
          order = orderByNumber;
        }
      } catch (e) {
        // Not an order number, continue
      }
    }
    
    // If we didn't find order by number, try by transaction ID
    if (!order) {
      order = await getOrderByTransactionId(transaction.id);
    }
    
    // Parse metadata
    let metaData = {};
    try {
      metaData = typeof transaction.metadata === 'string' 
        ? JSON.parse(transaction.metadata) 
        : (transaction.metadata || {});
    } catch (e) {
      logError('Failed to parse transaction metadata', { error: e, transactionId: transaction.id });
    }
    
    // Build payment schedules from metadata or order
    let paymentSchedules = [];
    if (order && order.selected_items) {
      try {
        const items = typeof order.selected_items === 'string' 
          ? JSON.parse(order.selected_items) 
          : order.selected_items;
        paymentSchedules = Array.isArray(items) ? items : [];
      } catch (e) {
        console.warn('Failed to parse order selected_items', e);
      }
    } else if (metaData.payment_schedules) {
      paymentSchedules = Array.isArray(metaData.payment_schedules) 
        ? metaData.payment_schedules 
        : [];
    }
    
    // Format payment data for frontend
    const paymentData = {
      transaction_id: transaction.reference || transaction.id.toString(),
      status: transaction.status === PAYMENT_STATUS.SUCCESSFUL ? 'completed' : transaction.status,
      amount: transaction.amount,
      payment_description: metaData.paymentType === PAYMENT_TYPE.RENEWAL_MANUAL 
        ? 'License Renewal' 
        : 'Vehicle Payment',
      created_at: transaction.created_at || transaction.paid_at,
      payment_gateway: transaction.payment_gateway || 'paystack',
      meta_data: {
        ...metaData,
        payment_schedules: paymentSchedules,
        is_bulk_payment: paymentSchedules.length > 1,
        delivery_address: metaData.delivery_details?.address || metaData.delivery_address,
        delivery_contact: metaData.delivery_details?.contact || metaData.delivery_contact,
        delivery_fee: metaData.delivery_fee || 0
      }
    };
    
    console.log('[Receipt] Returning receipt:', {
      carId: car.id,
      carSlug: car.slug,
      transactionId: transaction.id,
      transactionReference: transaction.reference,
      transactionStatus: transaction.status,
      orderId: order?.id,
      orderNumber: order?.order_number,
      hasPayment: !!paymentData
    });
    
    return paymentResponse.success(res, { 
      payment: paymentData,
      order: order || null
    }, 'Payment receipt retrieved');
    
  } catch (error) {
    logError('Get car payment receipt error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve payment receipt');
  }
};

/**
 * Get user's renewal orders
 * 
 * GET /api/orders
 * Query: page, limit, status
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
 * 
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

/**
 * Get user's subscriptions
 * 
 * GET /api/subscriptions
 * Query: page, limit, status
 */
export const getSubscriptions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, status } = req.query;
    
    const result = await getUserSubscriptions(userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || undefined
    });
    
    return paymentResponse.success(res, result, 'Subscriptions retrieved');
  } catch (error) {
    logError('Get subscriptions error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve subscriptions');
  }
};

/**
 * Create a subscription for a car
 * 
 * POST /api/subscriptions
 * Body: { car_slug, amount, plan }
 */
export const createSubscriptionHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { car_slug, amount, plan = 'annual' } = req.body;
    
    // Validate amount
    const amountValidation = validatePaymentAmount(amount);
    if (!amountValidation.valid) {
      return paymentResponse.error(res, amountValidation.error, HTTP_STATUS.BAD_REQUEST);
    }
    
    // Get car by slug
    const supabaseAdmin = getSupabaseAdmin();
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('id, slug, user_id')
      .eq('slug', car_slug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();
    
    if (carError || !car) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
    }
    
    // Check if car already has active subscription
    const hasActive = await hasActiveSubscription(car.id);
    if (hasActive) {
      return paymentResponse.error(res, ERROR_MESSAGES.SUBSCRIPTION_ALREADY_ACTIVE, HTTP_STATUS.CONFLICT);
    }
    
    // Create subscription (pending until first payment)
    const subscription = await createSubscription({
      userId,
      carId: car.id,
      email: userEmail,
      amount,
      plan
    });
    
    // Initialize payment for first subscription charge
    const transaction = await createTransaction({
      userId,
      carId: car.id,
      amount,
      paymentType: PAYMENT_TYPE.RENEWAL_AUTO,
      metadata: {
        subscription_id: subscription.id,
        subscription_code: subscription.subscription_code,
        car_slug,
        plan
      }
    });
    
    const callbackUrl = process.env.PAYMENT_CALLBACK_URL || 
      `${process.env.FRONTEND_URL}/payment/paystack/callback`;
    
    const paystackResult = await paystackInitialize({
      email: userEmail,
      amount,
      reference: transaction.reference,
      callback_url: callbackUrl,
      metadata: {
        transaction_id: transaction.id,
        subscription_id: subscription.id,
        car_id: car.id,
        is_subscription: true,
        plan
      }
    });
    
    await updateTransactionWithPaystackInit(transaction.reference, paystackResult);
    
    return paymentResponse.created(res, {
      subscription: {
        id: subscription.id,
        subscription_code: subscription.subscription_code,
        status: subscription.status,
        plan: subscription.plan
      },
      payment: {
        reference: transaction.reference,
        authorization_url: paystackResult.authorization_url,
        access_code: paystackResult.access_code
      }
    }, SUCCESS_MESSAGES.SUBSCRIPTION_CREATED);
    
  } catch (error) {
    logError('Create subscription error', error);
    
    if (error instanceof SubscriptionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to create subscription');
  }
};

/**
 * Cancel a subscription
 * 
 * PUT /api/subscriptions/:id/cancel
 * Body: { reason? }
 */
export const cancelSubscriptionHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;
    
    const subscription = await cancelSubscription(parseInt(id), userId, reason);
    
    return paymentResponse.success(res, { subscription }, SUCCESS_MESSAGES.SUBSCRIPTION_CANCELLED);
  } catch (error) {
    logError('Cancel subscription error', error);
    
    if (error instanceof SubscriptionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to cancel subscription');
  }
};

/**
 * Pause a subscription
 * 
 * PUT /api/subscriptions/:id/pause
 */
export const pauseSubscriptionHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    const subscription = await pauseSubscription(parseInt(id), userId);
    
    return paymentResponse.success(res, { subscription }, SUCCESS_MESSAGES.SUBSCRIPTION_PAUSED);
  } catch (error) {
    logError('Pause subscription error', error);
    
    if (error instanceof SubscriptionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to pause subscription');
  }
};

/**
 * Resume a paused subscription
 * 
 * PUT /api/subscriptions/:id/resume
 */
export const resumeSubscriptionHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    const subscription = await resumeSubscription(parseInt(id), userId);
    
    return paymentResponse.success(res, { subscription }, SUCCESS_MESSAGES.SUBSCRIPTION_RESUMED);
  } catch (error) {
    logError('Resume subscription error', error);
    
    if (error instanceof SubscriptionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to resume subscription');
  }
};

/**
 * Paystack Webhook Handler
 * 
 * POST /api/webhooks/paystack
 * 
 * CRITICAL: This endpoint must be publicly accessible (no auth)
 * and must verify the Paystack signature.
 */
export const handlePaystackWebhook = async (req, res) => {
  try {
    // Signature is verified in middleware
    const { event, data, eventId } = parseWebhookEvent(req.body);
    
    console.log('[Webhook] Received event:', event, 'Event ID:', eventId);
    
    switch (event) {
      case PAYSTACK_EVENTS.CHARGE_SUCCESS:
        await handleChargeSuccess(data, eventId);
        break;
        
      case PAYSTACK_EVENTS.CHARGE_FAILED:
        await handleChargeFailed(data, eventId);
        break;
        
      default:
        console.log('[Webhook] Unhandled event:', event);
    }
    
    // Always return 200 to acknowledge receipt
    return res.status(200).json({ received: true });
    
  } catch (error) {
    logError('Webhook processing error', error);
    // Still return 200 to prevent Paystack retries for processing errors
    return res.status(200).json({ received: true, error: error.message });
  }
};

/**
 * Handle successful charge webhook
 * @private
 * @param {Object} data - Webhook data payload
 * @param {string} eventId - Paystack webhook event ID for replay protection
 */
async function handleChargeSuccess(data, eventId) {
  const reference = data.reference;
  
  console.log('[Webhook] Processing charge.success:', reference, 'Event ID:', eventId);
  
  // Return result object to indicate success/failure
  const result = {
    success: false,
    processed: false,
    error: null,
    transaction: null,
    order: null
  };
  
  // SECURITY: Check for duplicate event ID (replay attack protection)
  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      console.log('[Webhook] Duplicate event ID detected, already processed:', eventId);
      result.processed = true; // Already processed
      result.transaction = existingTransaction;
      return result;
    }
  }
  
  // Get transaction by reference - try to find the most recent one
  console.log('[Webhook] Looking up transaction with reference:', reference);
  let transaction = await getTransactionByPaystackReference(reference);
  
  // If not found, try our reference field
  if (!transaction) {
    console.log('[Webhook] Transaction not found by Paystack reference, trying our reference field');
    transaction = await getTransactionByReference(reference);
  }
  
  if (!transaction) {
    console.log('[Webhook] Transaction not found for reference:', reference);
    result.error = 'Transaction not found';
    return result;
  }
  
  console.log('[Webhook] Found transaction:', {
    id: transaction.id,
    reference: transaction.reference,
    paystackReference: transaction.paystack_reference,
    carId: transaction.car_id,
    status: transaction.status,
    amount: transaction.amount,
    createdAt: transaction.created_at
  });
  
  result.transaction = transaction;
  
  // Check if already processed (idempotency)
  if (transaction.status === PAYMENT_STATUS.SUCCESSFUL) {
    console.log('[Webhook] Transaction already processed:', reference);
    result.success = true;
    result.processed = true;
    return result;
  }

  // SECURITY: Strict amount validation with bounds checking
  const amountMismatch = typeof data.amount === 'number' && 
    data.amount !== transaction.amount; // Strict equality (no tolerance)

  // Validate amount is within acceptable bounds
  if (typeof data.amount === 'number') {
    if (data.amount < PAYMENT_LIMITS.MIN_AMOUNT || 
        data.amount > PAYMENT_LIMITS.MAX_AMOUNT) {
      logError('Webhook amount out of bounds', { 
        reference, 
        amount: data.amount,
        min: PAYMENT_LIMITS.MIN_AMOUNT,
        max: PAYMENT_LIMITS.MAX_AMOUNT
      });
      await updateTransactionStatus(transaction.reference, {
        status: PAYMENT_STATUS.FAILED
      });
      result.error = 'Amount out of bounds';
      return result;
    }
  }

  // Currency validation - ensure NGN
  const currencyMismatch = data.currency && 
    data.currency !== transaction.currency && 
    data.currency !== 'NGN';

  const metadataUserId = data.metadata?.user_id || data.metadata?.userId;
  const metadataCarId = data.metadata?.car_id || data.metadata?.carId;
  const userMismatch = metadataUserId && String(metadataUserId) !== String(transaction.user_id);
  const carMismatch = metadataCarId && String(metadataCarId) !== String(transaction.car_id);

  if (amountMismatch || currencyMismatch || userMismatch || carMismatch) {
    const errorDetails = {
      reference,
      expectedAmount: transaction.amount,
      actualAmount: data.amount,
      expectedCurrency: transaction.currency,
      actualCurrency: data.currency,
      expectedUserId: transaction.user_id,
      actualUserId: metadataUserId || null,
      expectedCarId: transaction.car_id,
      actualCarId: metadataCarId || null
    };
    
    logError('Webhook payment validation failed', errorDetails);

    await updateTransactionStatus(transaction.reference, {
      status: PAYMENT_STATUS.FAILED
    });
    
    result.error = 'Payment validation failed: ' + JSON.stringify(errorDetails);
    return result;
  }
  
  // SECURITY: Parse metadata with proper error handling
  let metadata = {};
  try {
    metadata = typeof transaction.metadata === 'string' 
      ? JSON.parse(transaction.metadata) 
      : (transaction.metadata || {});
  } catch (e) {
    logError('CRITICAL: Failed to parse metadata in webhook', {
      error: e.message,
      reference,
      transactionId: transaction.id
    });
    await updateTransactionStatus(transaction.reference, {
      status: PAYMENT_STATUS.FAILED
    });
    result.error = 'Failed to parse transaction metadata: ' + e.message;
    return result;
  }
  
  // Determine order type
  const isSubscription = metadata.subscription_id || metadata.is_subscription;
  const orderType = isSubscription ? ORDER_TYPE.RENEWAL_AUTO : ORDER_TYPE.RENEWAL_MANUAL;

  // Extract payment schedule IDs (support both new and legacy field names)
  const paymentScheduleIds = metadata.paymentScheduleId || metadata.payment_schedule_id || metadata.selected_items || [];
  
  console.log('[Webhook] Processing payment success:', {
    reference,
    transactionId: transaction.id,
    orderType,
    selectedItems: paymentScheduleIds,
    renewalMonths: metadata.renewal_months || 12
  });
  
  let rpcResult;
  try {
    rpcResult = await processPaymentSuccess({
      reference: transaction.reference,
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel: data.channel,
      authorization_code: data.authorization?.authorization_code,
      paid_at: data.paid_at,
      orderType,
      renewalMonths: metadata.renewal_months || 12,
      selectedItems: paymentScheduleIds, // RPC function expects selectedItems
      renewalAmount: metadata.renewal_amount || transaction.amount,
      deliveryFee: metadata.delivery_fee || 0,
      deliveryAddress: metadata.delivery_details?.address || null,
      deliveryState: metadata.delivery_details?.state || null,
      deliveryLGA: metadata.delivery_details?.lga || null,
      deliveryContact: metadata.delivery_details?.contact || null,
      metadata
    });
  } catch (rpcError) {
    logError('CRITICAL: Failed to process payment success via RPC', {
      error: rpcError,
      reference,
      transactionId: transaction.id,
      message: rpcError.message,
      stack: rpcError.stack
    });
    result.error = 'RPC call failed: ' + rpcError.message;
    return result; // Return error result instead of throwing
  }

  if (rpcResult.alreadyProcessed) {
    console.log('[Webhook] Transaction already finalized:', reference);
    result.success = true;
    result.processed = true;
    return result;
  }

  // Get the order that was created
  let order = null;
  if (rpcResult.orderId) {
    try {
      order = await getOrderById(rpcResult.orderId);
      console.log('[Webhook] Order retrieved by ID:', rpcResult.orderId, order?.order_number || 'N/A');
    } catch (orderError) {
      logError('Failed to get order by ID, trying by transaction ID', {
        error: orderError,
        orderId: rpcResult.orderId,
        transactionId: transaction.id
      });
    }
  }
  
  // If order not found by ID, try by transaction ID
  if (!order) {
    try {
      order = await getOrderByTransactionId(transaction.id);
      if (order) {
        console.log('[Webhook] Order retrieved by transaction ID:', transaction.id, order.order_number);
      } else {
        console.warn('[Webhook] No order found for transaction:', transaction.id, 'This may indicate order creation failed');
        logError('Order not found after payment processing', {
          reference,
          transactionId: transaction.id,
          orderId: rpcResult.orderId,
          rpcResult: rpcResult
        });
      }
    } catch (orderError) {
      logError('Failed to get order by transaction ID', {
        error: orderError,
        transactionId: transaction.id
      });
    }
  }

  // Process successful payment side-effects (notifications, subscriptions, etc.)
  // This is done AFTER order creation to ensure we have the order number for notifications
  try {
    await processSuccessfulPayment(transaction, data, order);
  } catch (notifyError) {
    // Log notification errors but don't fail the payment processing
    // Payment and order are already created, so this is non-critical
    logError('Failed to send notifications after payment success', {
      error: notifyError,
      reference,
      transactionId: transaction.id,
      orderId: result.orderId
    });
  }
  
  // SECURITY: Store webhook event ID after successful processing to prevent replay attacks
  // Only store if we actually processed the payment (not already processed)
  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
      console.log('[Webhook] Event ID stored for replay protection:', eventId);
    } catch (error) {
      logError('Failed to store webhook event ID', { error, reference, eventId });
      // Don't fail the webhook processing if event ID storage fails
      // The transaction is already processed, so this is just for replay protection
    }
  }
  
  console.log('[Webhook] Charge success processed:', reference, {
    transactionId: transaction.id,
    orderId: rpcResult.orderId,
    orderNumber: order?.order_number || 'N/A'
  });
  
  // Refresh transaction to get updated status
  const updatedTransaction = await getTransactionByReference(reference);
  
  result.success = true;
  result.processed = true;
  result.transaction = updatedTransaction || transaction;
  result.order = order;
  return result;
}

/**
 * Handle failed charge webhook
 * @private
 * @param {Object} data - Webhook data payload
 * @param {string} eventId - Paystack webhook event ID for replay protection
 */
async function handleChargeFailed(data, eventId) {
  const reference = data.reference;
  
  console.log('[Webhook] Processing charge.failed:', reference, 'Event ID:', eventId);
  
  // SECURITY: Check for duplicate event ID (replay attack protection)
  if (eventId) {
    const existingTransaction = await getTransactionByWebhookEventId(eventId);
    if (existingTransaction) {
      console.log('[Webhook] Duplicate event ID detected, already processed:', eventId);
      return; // Prevent replay attack
    }
  }
  
  const transaction = await getTransactionByPaystackReference(reference);
  
  if (!transaction) {
    console.log('[Webhook] Transaction not found for reference:', reference);
    return;
  }
  
  // Update transaction status
  await updateTransactionStatus(transaction.reference, {
    status: PAYMENT_STATUS.FAILED
  });
  
  // SECURITY: Store webhook event ID after processing to prevent replay attacks
  if (eventId) {
    try {
      await updateTransactionWebhookEventId(reference, eventId);
      console.log('[Webhook] Event ID stored for replay protection:', eventId);
    } catch (error) {
      logError('Failed to store webhook event ID', { error, reference, eventId });
      // Don't fail the webhook processing if event ID storage fails
    }
  }
  
  // Send failure notification
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // Get user profile for email
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, first_name, user_id')
      .eq('id', transaction.user_id)
      .single();
    
    if (profile?.email) {
      // Get car details
      const { data: car } = await supabaseAdmin
        .from('cars')
        .select('vehicle_make, vehicle_model, registration_no')
        .eq('id', transaction.car_id)
        .single();
      
      await sendPaymentFailedEmail({
        to: profile.email,
        firstName: profile.first_name,
        amount: transaction.amount,
        reference: transaction.reference,
        carDetails: car
      });
      
      // Create in-app notification
      await createInAppNotification(
        transaction.user_id,
        'payment',
        'payment_failed',
        `Payment of ${formatAmount(transaction.amount)} failed. Please try again.`
      );
    }
  } catch (notifyError) {
    logError('Failed to send payment failure notification', notifyError);
  }
  
  console.log('[Webhook] Charge failed processed:', reference);
}

/**
 * Process a successful payment side-effects
 * - Send notifications (email and in-app)
 * - Activate subscription if applicable
 * 
 * Note: Car status update, payment status update, and order creation
 * are handled atomically in the process_payment_success RPC function.
 * 
 * @private
 */
async function processSuccessfulPayment(transaction, paystackData, order) {
  const supabaseAdmin = getSupabaseAdmin();
  
  try {
    // SECURITY: Car status update is now handled atomically in process_payment_success RPC function
    // This ensures car status, payment status, and order creation all succeed or fail together
    // No need to update car status here - it's done in the database transaction
    
    // Get car for notifications (status already updated in RPC)
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('*')
      .eq('id', transaction.car_id)
      .single();
    
    if (carError) {
      logError('Failed to fetch car for notifications', {
        error: carError,
        carId: transaction.car_id,
        reference: transaction.reference
      });
    }
    
    const metadata = typeof transaction.metadata === 'string' 
      ? JSON.parse(transaction.metadata) 
      : (transaction.metadata || {});
    const isSubscription = metadata.subscription_id || metadata.is_subscription;

    if (order?.order_number) {
      console.log('[Payment] Order created:', order.order_number);
    } else {
      console.warn('[Payment] No order found for transaction:', transaction.reference);
    }
    
    // If subscription payment, activate and store authorization
    if (isSubscription && metadata.subscription_id && paystackData.authorization) {
      try {
        await activateSubscription(
          metadata.subscription_id,
          paystackData.authorization.authorization_code,
          {
            card_type: paystackData.authorization.card_type,
            last4: paystackData.authorization.last4,
            exp_month: paystackData.authorization.exp_month,
            exp_year: paystackData.authorization.exp_year,
            bank: paystackData.authorization.bank
          }
        );
        console.log('[Payment] Subscription activated:', metadata.subscription_id);
      } catch (subError) {
        logError('Failed to activate subscription', {
          error: subError,
          subscriptionId: metadata.subscription_id,
          reference: transaction.reference
        });
        // Don't throw - continue with notifications
      }
    }
    
    // Send notifications
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('email, first_name, user_id')
      .eq('id', transaction.user_id)
      .single();
    
    if (profileError) {
      logError('Failed to fetch profile for notifications', {
        error: profileError,
        userId: transaction.user_id,
        reference: transaction.reference
      });
      return; // Can't send notifications without profile
    }
    
    if (!profile?.email) {
      logError('Profile found but no email address', {
        userId: transaction.user_id,
        reference: transaction.reference,
        profileId: profile?.id
      });
      return; // Can't send email without email address
    }
    
    // Send email notification
    try {
      await sendPaymentSuccessEmail({
        to: profile.email,
        firstName: profile.first_name || 'User',
        amount: transaction.amount,
        reference: transaction.reference,
        orderNumber: order?.order_number || null,
        carDetails: car
      });
      console.log('[Payment] Success email sent to:', profile.email);
    } catch (emailError) {
      logError('Failed to send payment success email', {
        error: emailError,
        email: profile.email,
        reference: transaction.reference
      });
      // Continue with in-app notification even if email fails
    }
    
    // Create in-app notification
    try {
      await createInAppNotification(
        transaction.user_id,
        'payment',
        'payment_success',
        order?.order_number
          ? `Payment of ${formatAmount(transaction.amount)} successful! Order ${order.order_number} created for processing.`
          : `Payment of ${formatAmount(transaction.amount)} successful! Your renewal is being processed.`
      );
      console.log('[Payment] In-app notification created for user:', transaction.user_id);
    } catch (notifError) {
      logError('Failed to create in-app notification', {
        error: notifError,
        userId: transaction.user_id,
        reference: transaction.reference
      });
      // Don't throw - email was already sent
    }
    
  } catch (error) {
    logError('Process successful payment error', {
      error,
      reference: transaction.reference,
      transactionId: transaction.id,
      stack: error.stack
    });
    // Don't throw - payment is already confirmed, but log for debugging
    throw error; // Re-throw to allow caller to handle it
  }
}

/**
 * Get Paystack public key (for frontend)
 * 
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

