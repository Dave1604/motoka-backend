import { getSupabaseAdmin } from '../../config/supabase.js';
import * as response from '../../utils/responses.js';
import { logError, logInfo } from '../../utils/logger.js';
import { validateRenewalItemsSelection } from '../../services/payment/renewalItems.service.js';
import { createTransaction, processPaymentSuccess } from '../../services/payment/transaction.service.js';
import { PAYMENT_GATEWAY, PAYMENT_STATUS, PAYMENT_TYPE } from '../../constants/payment.constants.js';

const CHANNELS = ['bank_transfer', 'cash', 'pos', 'other'];

/**
 * POST /admin/orders
 * Raise a renewal order for a customer who paid off the site.
 * Body: { user_id, car_id, selected_items: string[], renewal_state?, channel,
 *         paid_at?, offsite_reference?, note? }
 *
 * The order needs a transaction (renewal_orders.transaction_id is NOT NULL),
 * so this records the off-site payment as a successful 'manual' transaction
 * and then hands it to process_payment_success — the same RPC every gateway
 * uses — so order numbering, car status and wallet bonuses behave exactly as
 * they do for a card payment.
 */
export const adminCreateOrder = async (req, res) => {
  const {
    user_id,
    car_id,
    selected_items,
    renewal_state = null,
    channel = 'bank_transfer',
    paid_at = null,
    offsite_reference = null,
    note = null,
  } = req.body || {};

  if (!user_id || !car_id) {
    return response.error(res, 'user_id and car_id are required', 400);
  }
  if (!Array.isArray(selected_items) || selected_items.length === 0) {
    return response.error(res, 'Pick at least one renewal item', 400);
  }
  if (!CHANNELS.includes(channel)) {
    return response.error(res, `channel must be one of ${CHANNELS.join(', ')}`, 400);
  }
  if (paid_at && Number.isNaN(Date.parse(paid_at))) {
    return response.error(res, 'paid_at must be a valid date', 400);
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, user_id, first_name, last_name, email')
      .eq('id', user_id)
      .maybeSingle();
    if (!profile) return response.error(res, 'User not found', 404);

    const { data: car } = await supabase
      .from('cars')
      .select('id, user_id, registration_no, expiry_date')
      .eq('id', car_id)
      .maybeSingle();
    if (!car) return response.error(res, 'Car not found', 404);
    if (car.user_id !== profile.id) {
      return response.error(res, 'That car does not belong to this user', 400);
    }

    const validation = await validateRenewalItemsSelection(selected_items, renewal_state);
    if (!validation.valid) return response.error(res, validation.error, 400);
    const amount = validation.total;

    const paidAt = paid_at ? new Date(paid_at).toISOString() : new Date().toISOString();
    const tx = await createTransaction({
      userId: car.user_id,
      carId: car.id,
      amount,
      paymentType: PAYMENT_TYPE.RENEWAL_MANUAL,
      paymentGateway: PAYMENT_GATEWAY.MANUAL,
      metadata: {
        recorded_by_admin: req.user?.id || null,
        offsite_reference,
        note,
        selected_items,
        renewal_state,
        payment_type: PAYMENT_TYPE.RENEWAL_MANUAL,
      },
    });

    const result = await processPaymentSuccess({
      reference: tx.reference,
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel,
      paid_at: paidAt,
      orderType: 'renewal_manual',
      selectedItems: selected_items,
      renewalAmount: amount,
      deliveryFee: 0,
      metadata: { recorded_by_admin: req.user?.id || null, offsite_reference, note },
      renewalState: renewal_state,
    });

    const orderId = result?.order_id ?? result?.orderId ?? null;
    const { data: order } = orderId
      ? await supabase.from('renewal_orders').select('*').eq('id', orderId).maybeSingle()
      : await supabase.from('renewal_orders').select('*').eq('transaction_id', tx.id).maybeSingle();

    logInfo('[Admin Orders] off-site order raised', {
      admin: req.user?.id, user: profile.id, car: car.id, amount, channel, order: order?.order_number,
    });

    return response.created(res, { order, transaction: { id: tx.id, reference: tx.reference, amount } }, 'Order created');
  } catch (err) {
    logError('[Admin Orders] create failed', { error: err.message, user_id, car_id });
    return response.error(res, err.message || 'Failed to create order', err.statusCode || 500);
  }
};
