/**
 * SUBSCRIPTION CARD-SETUP CONTROLLER
 *
 * Handles `POST /api/subscriptions/card-setup`.
 *
 * This flow is for users whose vehicle papers are already valid (no renewal
 * payment needed today). They save a card now and the auto-billing job
 * charges them automatically when the car approaches expiry.
 *
 * Flow:
 *   1. Validate car belongs to user, has a future expiry_date, no active sub
 *   2. Calculate amount from selected (or default required) renewal items
 *   3. Set next_billing_date = car.expiry_date - 14 days (first charge attempt)
 *   4. Create subscription (pending) with the deferred billing date
 *   5. Create ₦50 tokenization transaction
 *   6. Initialise Paystack (card-only, refunded automatically by webhook)
 *   7. Return authorization_url for frontend to open the Paystack popup
 */

import { logError } from '../../utils/logger.js';
import { paymentResponse } from './payment-response.util.js';
import {
  createSubscription,
  hasActiveSubscription,
  SubscriptionError
} from '../../services/payment/subscription.service.js';
import {
  createTransaction,
  updateTransactionWithPaystackInit
} from '../../services/payment/transaction.service.js';
import { initializeTransaction as paystackInitialize, PaystackError } from '../../services/payment/paystack.service.js';
import { getRenewalItems } from '../../services/payment/renewalItems.service.js';
import {
  PAYMENT_TYPE,
  HTTP_STATUS,
  ERROR_MESSAGES,
  PAYMENT_LIMITS
} from '../../constants/payment.constants.js';
import { getSupabaseAdmin } from '../../config/supabase.js';

const MIN_DAYS_BEFORE_EXPIRY_FOR_SETUP = 45;
const CHARGE_ATTEMPT_DAYS_BEFORE_EXPIRY = 14;

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function daysBetween(dateStrA, dateStrB) {
  const [ay, am, ad] = dateStrA.split('-').map(Number);
  const [by, bm, bd] = dateStrB.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export const setupCardForValidCar = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { car_slug, selected_items } = req.body;

    if (!car_slug) {
      return paymentResponse.error(res, 'car_slug is required', HTTP_STATUS.BAD_REQUEST);
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch the car
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('id, slug, user_id, vehicle_make, vehicle_model, expiry_date')
      .eq('slug', car_slug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (carError || !car) {
      return paymentResponse.notFound(res, ERROR_MESSAGES.CAR_NOT_FOUND);
    }

    // Car must have an expiry date set and be far enough away
    const today = new Date().toISOString().split('T')[0];

    if (!car.expiry_date) {
      return paymentResponse.error(
        res,
        'This car has no expiry date on record. Please renew your documents first.',
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const daysUntilExpiry = daysBetween(today, car.expiry_date);

    if (daysUntilExpiry <= MIN_DAYS_BEFORE_EXPIRY_FOR_SETUP) {
      return paymentResponse.error(
        res,
        `Your car expires in ${daysUntilExpiry} days. Please use the standard renewal flow instead.`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // No existing active subscription
    const hasActive = await hasActiveSubscription(car.id);
    if (hasActive) {
      return paymentResponse.error(res, ERROR_MESSAGES.SUBSCRIPTION_ALREADY_ACTIVE, HTTP_STATUS.CONFLICT);
    }

    // Resolve renewal items and amount
    const allItems = await getRenewalItems();
    let itemsToUse;

    if (Array.isArray(selected_items) && selected_items.length > 0) {
      itemsToUse = allItems.filter(item => selected_items.includes(item.id));
      // Vehicle licence is always required
      const hasRequired = allItems
        .filter(i => i.required)
        .every(req => itemsToUse.some(i => i.id === req.id));
      if (!itemsToUse.length || !hasRequired) {
        return paymentResponse.error(
          res,
          'Vehicle Licence is required and cannot be deselected.',
          HTTP_STATUS.BAD_REQUEST
        );
      }
    } else {
      // Default: all required items
      itemsToUse = allItems.filter(item => item.required);
    }

    const amount = itemsToUse.reduce((sum, item) => sum + item.price, 0);

    if (amount < PAYMENT_LIMITS.MIN_AMOUNT) {
      return paymentResponse.error(res, ERROR_MESSAGES.AMOUNT_TOO_LOW, HTTP_STATUS.BAD_REQUEST);
    }

    // Billing date = car expiry - 14 days (first charge attempt window)
    const nextBillingDate = addDays(car.expiry_date, -CHARGE_ATTEMPT_DAYS_BEFORE_EXPIRY);

    // Create subscription in PENDING state with deferred billing date
    const subscription = await createSubscription({
      userId,
      carId: car.id,
      email: userEmail,
      amount,
      plan: 'annual',
      renewalDocumentIds: itemsToUse.map(i => i.id),
      nextBillingDate,
      metadata: { setup_source: 'card_setup', car_expiry_date: car.expiry_date }
    });

    // Create ₦50 tokenization transaction
    const transaction = await createTransaction({
      userId,
      carId: car.id,
      amount: PAYMENT_LIMITS.TOKENIZATION_AMOUNT,
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
      amount: PAYMENT_LIMITS.TOKENIZATION_AMOUNT,
      reference: transaction.reference,
      callback_url: callbackUrl,
      channels: ['card'],
      metadata: {
        transaction_id: transaction.id,
        subscription_id: subscription.id,
        is_tokenization: true
      }
    });

    await updateTransactionWithPaystackInit(transaction.reference, paystackResult);

    return paymentResponse.created(res, {
      subscription: {
        id: subscription.id,
        subscription_code: subscription.subscription_code,
        status: subscription.status,
        amount,
        next_billing_date: nextBillingDate,
        renewal_items: itemsToUse.map(i => ({ id: i.id, name: i.name, price: i.price }))
      },
      payment: {
        reference: transaction.reference,
        authorization_url: paystackResult.authorization_url,
        access_code: paystackResult.access_code
      }
    }, 'Card setup initiated');

  } catch (error) {
    logError('Card setup error', error);

    if (error instanceof SubscriptionError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }
    if (error instanceof PaystackError) {
      return paymentResponse.error(res, error.message, error.statusCode);
    }

    return paymentResponse.serverError(res, 'Failed to set up auto-renewal');
  }
};
