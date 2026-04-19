import { logError } from '../../utils/logger.js';
import { getUserFriendlyMessage } from '../../utils/errorSanitizer.js';
import { paymentResponse } from './payment-response.util.js';
import {
  createSubscription,
  getUserSubscriptions,
  hasActiveSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  SubscriptionError
} from '../../services/payment/subscription.service.js';
import {
  createTransaction,
  updateTransactionWithPaystackInit
} from '../../services/payment/transaction.service.js';
import {
  initializeTransaction as paystackInitialize
} from '../../services/payment/paystack.service.js';
import {
  PAYMENT_TYPE,
  HTTP_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  PAYMENT_LIMITS,
  SUBSCRIPTION_STATUS
} from '../../constants/payment.constants.js';
import { PaystackError } from '../../services/payment/paystack.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';

/**
 * Subscription Controller
 * 
 * Handles subscription-related endpoints.
 */

/**
 * Get user's subscriptions
 * GET /api/subscriptions
 */
export const getSubscriptions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, status, car_slug } = req.query;

    const result = await getUserSubscriptions(userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status || undefined,
      carSlug: car_slug || undefined
    });
    
    return paymentResponse.success(res, result, 'Subscriptions retrieved');
  } catch (error) {
    logError('Get subscriptions error', error);
    return paymentResponse.serverError(res, 'Failed to retrieve subscriptions');
  }
};

/**
 * Create a subscription for a car
 * POST /api/subscriptions
 */
export const createSubscriptionHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { car_slug, amount, plan = 'annual', selected_items = [] } = req.body;
    
    // Validate amount is a number within acceptable bounds (kobo)
    if (typeof amount !== 'number' || amount < PAYMENT_LIMITS.MIN_AMOUNT || amount > PAYMENT_LIMITS.MAX_AMOUNT) {
      return paymentResponse.error(res, ERROR_MESSAGES.AMOUNT_TOO_LOW, HTTP_STATUS.BAD_REQUEST);
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
      plan,
      renewalDocumentIds: Array.isArray(selected_items) ? selected_items : []
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
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof SubscriptionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    
    if (error instanceof PaystackError) {
      const message = isProduction ? getUserFriendlyMessage(error) : error.message;
      return paymentResponse.error(res, message, error.statusCode);
    }
    
    return paymentResponse.serverError(res, 'Failed to create subscription');
  }
};

/**
 * Cancel a subscription
 * PUT /api/subscriptions/:id/cancel
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
 * Initiate ₦50 card tokenization for a pending subscription
 * POST /api/subscriptions/:id/tokenize
 *
 * Bank transfer users have no card on file after their first payment.
 * This kicks off a ₦50 Paystack charge (card-only, no bank transfer) that
 * the webhook will immediately refund, storing the reusable authorization_code
 * on the subscription so auto-renewal can charge the card later.
 */
export const initiateTokenization = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { id } = req.params;

    const supabaseAdmin = getSupabaseAdmin();
    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('id', parseInt(id))
      .eq('user_id', userId)
      .single();

    if (error || !subscription) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND);
    }

    if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE && subscription.authorization_code) {
      return paymentResponse.error(res, 'Card already on file for this subscription', HTTP_STATUS.CONFLICT);
    }

    if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) {
      return paymentResponse.error(res, ERROR_MESSAGES.SUBSCRIPTION_CANCELLED, HTTP_STATUS.CONFLICT);
    }

    const amount = PAYMENT_LIMITS.TOKENIZATION_AMOUNT;

    const transaction = await createTransaction({
      userId,
      carId: subscription.car_id,
      amount,
      paymentType: PAYMENT_TYPE.TOKENIZATION,
      metadata: {
        subscription_id: subscription.id,
        subscription_code: subscription.subscription_code,
        is_tokenization: true
      }
    });

    const callbackUrl = `${process.env.FRONTEND_URL}/payment/paystack/callback`;

    const paystackResult = await paystackInitialize({
      email: userEmail,
      amount,
      reference: transaction.reference,
      callback_url: callbackUrl,
      channels: ['card'], // card only — bank transfer cannot tokenize
      metadata: {
        transaction_id: transaction.id,
        subscription_id: subscription.id,
        is_tokenization: true
      }
    });

    await updateTransactionWithPaystackInit(transaction.reference, paystackResult);

    return paymentResponse.success(res, {
      payment: {
        reference: transaction.reference,
        authorization_url: paystackResult.authorization_url,
        access_code: paystackResult.access_code
      }
    }, 'Tokenization initiated');

  } catch (error) {
    logError('Initiate tokenization error', error);

    if (error instanceof PaystackError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }

    return paymentResponse.serverError(res, 'Failed to initiate tokenization');
  }
};

/**
 * Resume a paused subscription
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
