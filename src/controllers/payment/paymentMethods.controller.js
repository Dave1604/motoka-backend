import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

let banksCache = null;
let banksCacheAt = 0;
const BANKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * GET /api/banks
 * Returns all Nigerian banks from Paystack, cached for 1 hour.
 */
export const getBanks = async (req, res) => {
  try {
    if (banksCache && Date.now() - banksCacheAt < BANKS_CACHE_TTL) {
      return res.json({ success: true, banks: banksCache });
    }

    const response = await fetch(
      `${PAYSTACK_BASE_URL}/bank?country=nigeria&use_cursor=false&perPage=200`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      logError('[getBanks] Paystack error', data);
      return res.status(502).json({ success: false, message: 'Failed to fetch bank list' });
    }

    banksCache = data.data;
    banksCacheAt = Date.now();

    return res.json({ success: true, banks: banksCache });
  } catch (err) {
    logError('[getBanks] error', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch bank list' });
  }
};

/**
 * GET /api/payment-methods
 * Returns the authenticated user's saved payment methods (cards on file from subscriptions).
 */
export const getPaymentMethods = async (req, res) => {
  try {
    const userId = req.user.id;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: subscriptions, error } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        id,
        status,
        authorization_code,
        card_type,
        card_last4,
        card_bank,
        card_exp_month,
        card_exp_year,
        amount,
        next_billing_date,
        cars:car_id (
          slug,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          registration_no
        )
      `)
      .eq('user_id', userId)
      .not('authorization_code', 'is', null)
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false });

    if (error) {
      logError('[getPaymentMethods] DB error', error);
      return res.status(500).json({ success: false, message: 'Failed to retrieve payment methods' });
    }

    const methods = (subscriptions || []).map((sub) => ({
      id: sub.id,
      subscription_id: sub.id,
      type: 'card',
      card_type: sub.card_type,
      last4: sub.card_last4,
      bank: sub.card_bank,
      exp_month: sub.card_exp_month,
      exp_year: sub.card_exp_year,
      subscription_status: sub.status,
      next_billing_date: sub.next_billing_date,
      amount: sub.amount,
      car: sub.cars,
    }));

    return res.json({ success: true, payment_methods: methods });
  } catch (err) {
    logError('[getPaymentMethods] error', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /api/payment-methods/pending-tokenization
 * Returns active/paused subscriptions that have no card on file yet.
 * These are subscriptions where the user paid via bank transfer and needs to add a card for auto-renewal.
 */
export const getPendingTokenizationSubscriptions = async (req, res) => {
  try {
    const userId = req.user.id;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: subscriptions, error } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        id,
        status,
        amount,
        next_billing_date,
        cars:car_id (
          slug,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          registration_no
        )
      `)
      .eq('user_id', userId)
      .is('authorization_code', null)
      .in('status', ['active', 'paused', 'pending'])
      .order('created_at', { ascending: false });

    if (error) {
      logError('[getPendingTokenizationSubscriptions] DB error', error);
      return res.status(500).json({ success: false, message: 'Failed to retrieve subscriptions' });
    }

    return res.json({ success: true, subscriptions: subscriptions || [] });
  } catch (err) {
    logError('[getPendingTokenizationSubscriptions] error', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
