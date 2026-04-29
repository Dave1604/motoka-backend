/**
 * SUBSCRIPTION SERVICE
 * 
 * Handles database operations for recurring payment subscriptions.
 * Used for auto-renewal of vehicle documents.
 */

import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';
import {
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_PLAN,
  HTTP_STATUS,
  ERROR_MESSAGES,
  PAGINATION,
  RETRY_CONFIG
} from '../../constants/payment.constants.js';
import {
  generateSubscriptionCode,
  getMonthsForPlan,
  calculateNextBillingDate,
  isWithinDays,
  getTodayDateString
} from '../../utils/paymentHelpers.js';

/**
 * SubscriptionError - Custom error class for subscription operations
 */
export class SubscriptionError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = 'SubscriptionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Create a new subscription
 * 
 * @param {Object} options - Subscription options
 * @param {string} options.userId - User UUID
 * @param {number} options.carId - Car ID
 * @param {string} options.email - Customer email (for Paystack)
 * @param {number} options.amount - Amount in kobo
 * @param {string} [options.plan] - Subscription plan (default: annual)
 * @param {string} [options.authorizationCode] - Paystack authorization code
 * @param {Object} [options.cardDetails] - Card details from authorization
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {Promise<Object>} Created subscription
 */
export async function createSubscription({
  userId,
  carId,
  email,
  amount,
  plan = SUBSCRIPTION_PLAN.ANNUAL,
  authorizationCode = null,
  cardDetails = {},
  renewalDocumentIds = [],
  metadata = {},
  nextBillingDate: overrideNextBillingDate = null
}) {
  const supabaseAdmin = getSupabaseAdmin();

  // Validate plan
  if (!Object.values(SUBSCRIPTION_PLAN).includes(plan)) {
    throw new SubscriptionError('Invalid subscription plan', HTTP_STATUS.BAD_REQUEST);
  }

  // Check if car already has an active subscription
  const hasActive = await hasActiveSubscription(carId);
  if (hasActive) {
    throw new SubscriptionError(
      ERROR_MESSAGES.SUBSCRIPTION_ALREADY_ACTIVE,
      HTTP_STATUS.CONFLICT,
      'DUPLICATE_SUBSCRIPTION'
    );
  }

  // Calculate billing dates — allow override for deferred (card-setup) flow
  const billingCycleMonths = getMonthsForPlan(plan);
  const nextBillingDate = overrideNextBillingDate || calculateNextBillingDate(null, plan);
  
  // Generate unique subscription code
  const subscriptionCode = generateSubscriptionCode();
  
  // Determine initial status
  const initialStatus = authorizationCode 
    ? SUBSCRIPTION_STATUS.ACTIVE 
    : SUBSCRIPTION_STATUS.PENDING;
  
  // Create subscription record
  const subscriptionData = {
    subscription_code: subscriptionCode,
    user_id: userId,
    car_id: carId,
    email,
    plan,
    status: initialStatus,
    amount,
    currency: 'NGN',
    billing_cycle_months: billingCycleMonths,
    next_billing_date: nextBillingDate,
    authorization_code: authorizationCode,
    card_type: cardDetails.card_type || null,
    card_last4: cardDetails.last4 || null,
    card_exp_month: cardDetails.exp_month || null,
    card_exp_year: cardDetails.exp_year || null,
    card_bank: cardDetails.bank || null,
    activated_at: authorizationCode ? new Date().toISOString() : null,
    renewal_document_ids: Array.isArray(renewalDocumentIds) ? renewalDocumentIds : [],
    metadata
  };
  
  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .insert(subscriptionData)
    .select('*')
    .single();
  
  if (error) {
    logError('Create subscription error', { error, userId, carId });
    throw new SubscriptionError('Failed to create subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription created:', {
    code: subscription.subscription_code,
    carId,
    plan,
    status: initialStatus
  });
  
  return subscription;
}

/**
 * Get subscription by ID
 * 
 * @param {number} subscriptionId - Subscription ID
 * @returns {Promise<Object|null>} Subscription or null
 */
export async function getSubscriptionById(subscriptionId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date
      )
    `)
    .eq('id', subscriptionId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get subscription by ID error', { error, subscriptionId });
    throw new SubscriptionError('Failed to retrieve subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  return subscription || null;
}

/**
 * Get subscription by code
 * 
 * @param {string} subscriptionCode - Subscription code
 * @returns {Promise<Object|null>} Subscription or null
 */
export async function getSubscriptionByCode(subscriptionCode) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date
      )
    `)
    .eq('subscription_code', subscriptionCode)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get subscription by code error', { error, subscriptionCode });
    throw new SubscriptionError('Failed to retrieve subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  return subscription || null;
}

/**
 * Get active subscription for a car
 * 
 * @param {number} carId - Car ID
 * @returns {Promise<Object|null>} Active subscription or null
 */
export async function getActiveSubscriptionForCar(carId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('car_id', carId)
    .eq('status', SUBSCRIPTION_STATUS.ACTIVE)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logError('Get active subscription error', { error, carId });
    return null;
  }
  
  return subscription || null;
}

/**
 * Check if a car has an active subscription
 * 
 * @param {number} carId - Car ID
 * @returns {Promise<boolean>} True if active subscription exists
 */
export async function hasActiveSubscription(carId) {
  const subscription = await getActiveSubscriptionForCar(carId);
  return subscription !== null;
}

/**
 * Get user's subscriptions with pagination
 * 
 * @param {string} userId - User UUID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} { subscriptions, pagination }
 */
export async function getUserSubscriptions(userId, options = {}) {
  const page = Math.max(PAGINATION.MIN_PAGE, options.page || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(PAGINATION.MIN_LIMIT, options.limit || PAGINATION.DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  
  const supabaseAdmin = getSupabaseAdmin();
  
  let query = supabaseAdmin
    .from('subscriptions')
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

  if (options.carSlug) {
    const { data: car } = await supabaseAdmin
      .from('cars')
      .select('id')
      .eq('slug', options.carSlug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (!car) {
      return {
        subscriptions: [],
        pagination: { current_page: page, limit, total_subscriptions: 0, total_pages: 0, has_next: false, has_prev: false }
      };
    }
    query = query.eq('car_id', car.id);
  }

  const { data: subscriptions, count, error } = await query;
  
  if (error) {
    logError('Get user subscriptions error', { error, userId });
    throw new SubscriptionError('Failed to retrieve subscriptions', HTTP_STATUS.SERVER_ERROR);
  }
  
  const totalSubscriptions = count || 0;
  const totalPages = Math.ceil(totalSubscriptions / limit);
  
  return {
    subscriptions: subscriptions || [],
    pagination: {
      current_page: page,
      limit,
      total_subscriptions: totalSubscriptions,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    }
  };
}

/**
 * Activate a pending subscription (after first payment)
 * 
 * @param {number} subscriptionId - Subscription ID
 * @param {string} authorizationCode - Paystack authorization code
 * @param {Object} cardDetails - Card details from authorization
 * @returns {Promise<Object>} Updated subscription
 */
export async function activateSubscription(subscriptionId, authorizationCode, cardDetails = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
    return subscription; // Already active
  }
  
  const updateData = {
    status: SUBSCRIPTION_STATUS.ACTIVE,
    authorization_code: authorizationCode,
    activated_at: new Date().toISOString(),
    retry_count: 0
  };
  
  if (cardDetails.card_type) updateData.card_type = cardDetails.card_type;
  if (cardDetails.last4) updateData.card_last4 = cardDetails.last4;
  if (cardDetails.exp_month) updateData.card_exp_month = cardDetails.exp_month;
  if (cardDetails.exp_year) updateData.card_exp_year = cardDetails.exp_year;
  if (cardDetails.bank) updateData.card_bank = cardDetails.bank;
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update(updateData)
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Activate subscription error', { error, subscriptionId });
    throw new SubscriptionError('Failed to activate subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription activated:', { subscriptionId });
  
  return updated;
}

/**
 * Update subscription after successful billing
 * 
 * @param {number} subscriptionId - Subscription ID
 * @param {number} transactionId - New transaction ID
 * @returns {Promise<Object>} Updated subscription
 */
export async function updateSubscriptionAfterBilling(subscriptionId, transactionId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  const nextBillingDate = calculateNextBillingDate(
    getTodayDateString(),
    subscription.plan
  );
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      last_billing_date: getTodayDateString(),
      next_billing_date: nextBillingDate,
      last_transaction_id: transactionId,
      retry_count: 0,
      last_retry_at: null
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Update subscription after billing error', { error, subscriptionId });
    throw new SubscriptionError('Failed to update subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription updated after billing:', {
    subscriptionId,
    nextBillingDate
  });
  
  return updated;
}

/**
 * Record a failed billing attempt
 * 
 * @param {number} subscriptionId - Subscription ID
 * @returns {Promise<Object>} Updated subscription
 */
export async function recordFailedBilling(subscriptionId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  const newRetryCount = (subscription.retry_count || 0) + 1;
  
  // Check if max retries exceeded
  if (newRetryCount >= RETRY_CONFIG.MAX_RETRIES) {
    return expireSubscription(subscriptionId, 'Max payment retries exceeded');
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      retry_count: newRetryCount,
      last_retry_at: new Date().toISOString()
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Record failed billing error', { error, subscriptionId });
    throw new SubscriptionError('Failed to update subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Failed billing recorded:', {
    subscriptionId,
    retryCount: newRetryCount
  });
  
  return updated;
}

/**
 * Pause a subscription
 * 
 * @param {number} subscriptionId - Subscription ID
 * @param {string} userId - User UUID (for verification)
 * @returns {Promise<Object>} Updated subscription
 */
export async function pauseSubscription(subscriptionId, userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (subscription.user_id !== userId) {
    throw new SubscriptionError(ERROR_MESSAGES.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN);
  }
  
  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw new SubscriptionError('Can only pause active subscriptions', HTTP_STATUS.CONFLICT);
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      status: SUBSCRIPTION_STATUS.PAUSED,
      paused_at: new Date().toISOString()
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Pause subscription error', { error, subscriptionId });
    throw new SubscriptionError('Failed to pause subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription paused:', { subscriptionId });
  
  return updated;
}

/**
 * Resume a paused subscription
 * 
 * @param {number} subscriptionId - Subscription ID
 * @param {string} userId - User UUID (for verification)
 * @returns {Promise<Object>} Updated subscription
 */
export async function resumeSubscription(subscriptionId, userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (subscription.user_id !== userId) {
    throw new SubscriptionError(ERROR_MESSAGES.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN);
  }
  
  if (subscription.status !== SUBSCRIPTION_STATUS.PAUSED) {
    throw new SubscriptionError('Can only resume paused subscriptions', HTTP_STATUS.CONFLICT);
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      status: SUBSCRIPTION_STATUS.ACTIVE,
      paused_at: null
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Resume subscription error', { error, subscriptionId });
    throw new SubscriptionError('Failed to resume subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription resumed:', { subscriptionId });
  
  return updated;
}

/**
 * Cancel a subscription
 * 
 * @param {number} subscriptionId - Subscription ID
 * @param {string} userId - User UUID (for verification)
 * @param {string} [reason] - Cancellation reason
 * @returns {Promise<Object>} Updated subscription
 */
export async function cancelSubscription(subscriptionId, userId, reason = null) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  if (subscription.user_id !== userId) {
    throw new SubscriptionError(ERROR_MESSAGES.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN);
  }
  
  if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) {
    throw new SubscriptionError(ERROR_MESSAGES.SUBSCRIPTION_CANCELLED, HTTP_STATUS.CONFLICT);
  }
  
  const metadata = subscription.metadata || {};
  if (reason) {
    metadata.cancellation_reason = reason;
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      status: SUBSCRIPTION_STATUS.CANCELLED,
      cancelled_at: new Date().toISOString(),
      metadata
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Cancel subscription error', { error, subscriptionId });
    throw new SubscriptionError('Failed to cancel subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription cancelled:', { subscriptionId, reason });
  
  return updated;
}

/**
 * Expire a subscription due to payment failures
 * 
 * @param {number} subscriptionId - Subscription ID
 * @param {string} [reason] - Expiration reason
 * @returns {Promise<Object>} Updated subscription
 */
export async function expireSubscription(subscriptionId, reason = 'Payment failed') {
  const supabaseAdmin = getSupabaseAdmin();
  
  const metadata = { expiration_reason: reason };
  
  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      status: SUBSCRIPTION_STATUS.EXPIRED,
      expires_at: new Date().toISOString(),
      metadata: supabaseAdmin.sql`metadata || ${JSON.stringify(metadata)}`
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();
  
  if (error) {
    logError('Expire subscription error', { error, subscriptionId });
    throw new SubscriptionError('Failed to expire subscription', HTTP_STATUS.SERVER_ERROR);
  }
  
  console.log('[Subscription Service] Subscription expired:', { subscriptionId, reason });
  
  return updated;
}

/**
 * Get subscriptions due for billing
 * 
 * Used by cron job to process auto-renewals.
 * 
 * @param {number} [daysAhead] - Days ahead to look (default: 30)
 * @returns {Promise<Object[]>} Subscriptions due for billing
 */
export async function getSubscriptionsDueForBilling(daysAhead = 30) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const today = getTodayDateString();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  const futureDateString = futureDate.toISOString().split('T')[0];
  
  const { data: subscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select(`
      *,
      cars:car_id (
        id,
        slug,
        vehicle_make,
        vehicle_model,
        registration_no,
        expiry_date
      )
    `)
    .eq('status', SUBSCRIPTION_STATUS.ACTIVE)
    .lte('next_billing_date', futureDateString)
    .not('authorization_code', 'is', null)
    .order('next_billing_date', { ascending: true });
  
  if (error) {
    logError('Get subscriptions due for billing error', { error });
    throw new SubscriptionError('Failed to retrieve subscriptions', HTTP_STATUS.SERVER_ERROR);
  }
  
  return subscriptions || [];
}

