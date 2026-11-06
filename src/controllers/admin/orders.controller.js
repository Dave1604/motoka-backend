import { getSupabaseAdmin } from '../../config/supabase.js';
import * as response from '../../utils/responses.js';
import { logError, logInfo } from '../../utils/logger.js';
import { validateRenewalItemsSelection } from '../../services/payment/renewalItems.service.js';
import { createTransaction, processPaymentSuccess } from '../../services/payment/transaction.service.js';
import { buildPaymentMetadata, nairaToKobo } from '../../utils/paymentHelpers.js';
import { ORDER_TYPE, PAYMENT_GATEWAY, PAYMENT_STATUS, PAYMENT_TYPE } from '../../constants/payment.constants.js';

const CHANNELS = ['bank_transfer', 'cash', 'pos', 'other'];
const KINDS = ['renewal', 'plate_number', 'driver_license'];
const LICENSE_TYPES = ['new', 'renew'];
const LICENSE_DURATIONS = ['3yr', '5yr', 'international'];

/**
 * POST /admin/orders
 * Raise an order for a customer who paid off the site.
 *
 * Body: { user_id, kind: renewal | plate_number | driver_license,
 *         car_id            (renewal, plate_number),
 *         selected_items[], renewal_state?   (renewal)
 *         plate_type, sub_type?              (plate_number)
 *         license_type, duration             (driver_license)
 *         channel, paid_at?, offsite_reference?, note? }
 *
 * The order needs a transaction (renewal_orders.transaction_id is NOT NULL),
 * so the off-site payment is recorded as a successful 'manual' transaction
 * carrying the same metadata a gateway payment would, then handed to
 * process_payment_success — the one RPC every gateway uses — so numbering,
 * car status and wallet bonuses behave exactly as they do for a card payment.
 */
export const adminCreateOrder = async (req, res) => {
  const {
    user_id,
    kind = 'renewal',
    car_id = null,
    selected_items = [],
    renewal_state = null,
    plate_type = null,
    sub_type = null,
    license_type = null,
    duration = null,
    channel = 'bank_transfer',
    paid_at = null,
    offsite_reference = null,
    note = null,
  } = req.body || {};

  if (!user_id) return response.error(res, 'user_id is required', 400);
  if (!KINDS.includes(kind)) return response.error(res, `kind must be one of ${KINDS.join(', ')}`, 400);
  if (!CHANNELS.includes(channel)) return response.error(res, `channel must be one of ${CHANNELS.join(', ')}`, 400);
  if (paid_at && Number.isNaN(Date.parse(paid_at))) return response.error(res, 'paid_at must be a valid date', 400);

  const needsCar = kind !== 'driver_license';
  if (needsCar && !car_id) return response.error(res, 'car_id is required', 400);

  const supabase = getSupabaseAdmin();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, user_id, first_name, last_name, email')
      .eq('id', user_id)
      .maybeSingle();
    if (!profile) return response.error(res, 'User not found', 404);

    let car = null;
    if (needsCar) {
      const { data } = await supabase
        .from('cars')
        .select('id, user_id, slug, registration_no')
        .eq('id', car_id)
        .maybeSingle();
      if (!data) return response.error(res, 'Car not found', 404);
      if (data.user_id !== profile.id) return response.error(res, 'That car does not belong to this user', 400);
      car = data;
    }

    // ── Price it the way the gateway path does ─────────────────────────────
    let amount;
    let paymentType;
    let orderType;
    let items = [];
    const extra = {};

    if (kind === 'renewal') {
      if (!Array.isArray(selected_items) || selected_items.length === 0) {
        return response.error(res, 'Pick at least one renewal item', 400);
      }
      const validation = await validateRenewalItemsSelection(selected_items, renewal_state);
      if (!validation.valid) return response.error(res, validation.error, 400);
      amount = validation.total;
      items = selected_items;
      paymentType = PAYMENT_TYPE.RENEWAL_MANUAL;
      orderType = ORDER_TYPE.RENEWAL_MANUAL;
      extra.renewalState = renewal_state || null;
    } else if (kind === 'plate_number') {
      if (!plate_type) return response.error(res, 'plate_type is required for a plate number order', 400);
      let q = supabase.from('plate_number_prices').select('price').eq('plate_type', plate_type).eq('is_active', true);
      q = sub_type ? q.eq('sub_type', sub_type) : q.is('sub_type', null);
      const { data: price } = await q.maybeSingle();
      if (!price) return response.error(res, `No price configured for plate type "${plate_type}"${sub_type ? ` / ${sub_type}` : ''}`, 400);
      amount = nairaToKobo(Number(price.price));
      paymentType = PAYMENT_TYPE.PLATE_NUMBER;
      orderType = ORDER_TYPE.PLATE_NUMBER;
      extra.plateType = plate_type;
      extra.subType = sub_type || null;
    } else {
      const lt = String(license_type || '').toLowerCase();
      const dur = String(duration || '').toLowerCase();
      if (!LICENSE_TYPES.includes(lt)) return response.error(res, `license_type must be one of ${LICENSE_TYPES.join(', ')}`, 400);
      if (!LICENSE_DURATIONS.includes(dur)) return response.error(res, `duration must be one of ${LICENSE_DURATIONS.join(', ')}`, 400);
      const { data: price } = await supabase
        .from('driver_license_prices').select('price')
        .eq('license_type', lt).eq('duration', dur).eq('is_active', true)
        .maybeSingle();
      if (!price) return response.error(res, `No price configured for a ${lt} licence / ${dur}`, 400);
      amount = nairaToKobo(Number(price.price));
      paymentType = PAYMENT_TYPE.DRIVER_LICENSE;
      orderType = ORDER_TYPE.DRIVER_LICENSE;
      extra.licenseType = lt;
      extra.licenseDuration = dur;
    }

    const paidAt = paid_at ? new Date(paid_at).toISOString() : new Date().toISOString();
    const metadata = {
      ...buildPaymentMetadata({
        carId: car?.id ?? null,
        carSlug: car?.slug ?? null,
        paymentType,
        renewalMonths: 12,
        userId: profile.id,
        selectedItems: items,
        paymentScheduleId: items,
        renewalAmount: amount,
        deliveryFee: 0,
        ...extra,
      }),
      recorded_by_admin: req.user?.id || null,
      offsite_reference,
      note,
    };

    const tx = await createTransaction({
      userId: profile.id,
      carId: car?.id ?? null,
      amount,
      paymentType,
      paymentGateway: PAYMENT_GATEWAY.MANUAL,
      metadata,
    });

    const result = await processPaymentSuccess({
      reference: tx.reference,
      status: PAYMENT_STATUS.SUCCESSFUL,
      channel,
      paid_at: paidAt,
      orderType,
      renewalMonths: 12,
      selectedItems: items,
      renewalAmount: amount,
      deliveryFee: 0,
      metadata: { recorded_by_admin: req.user?.id || null, offsite_reference, note },
      renewalState: extra.renewalState || null,
    });

    const orderId = result?.order_id ?? result?.orderId ?? null;
    const { data: order } = orderId
      ? await supabase.from('renewal_orders').select('*').eq('id', orderId).maybeSingle()
      : await supabase.from('renewal_orders').select('*').eq('transaction_id', tx.id).maybeSingle();

    logInfo('[Admin Orders] off-site order raised', {
      admin: req.user?.id, user: profile.id, kind, car: car?.id ?? null, amount, channel, order: order?.order_number,
    });

    return response.created(res, { order, transaction: { id: tx.id, reference: tx.reference, amount } }, 'Order created');
  } catch (err) {
    logError('[Admin Orders] create failed', { error: err.message, user_id, kind, car_id });
    return response.error(res, err.message || 'Failed to create order', err.statusCode || 500);
  }
};
