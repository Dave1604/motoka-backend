import { getSupabaseAdmin } from '../../config/supabase.js';
import { estimateWeightKg, toTerminalWeightKg } from './parcel.weight.js';
import { getAllStates } from '../location.service.js';
import {
  arrangePickup,
  getShipmentQuotes,
  isTerminalBookingEnabled,
  isTerminalConfigured,
  TerminalError,
  trackTerminalShipment,
} from './terminal.service.js';
import {
  createShipmentLabel,
  isShipbubbleBookingEnabled,
  isShipbubbleConfigured,
  ShipbubbleError,
  trackShipbubbleShipment,
} from './shipbubble.service.js';
import {
  DeliveryQuoteError,
  deliveryAddressPayload,
  deliveryAddressString,
  getPackagingId,
  parcelPayload,
  pickCheapestNgnRate,
  pickupAddressPayload,
  shipbubblePackageDimension,
  shipbubblePackageItems,
  pickupAddressString,
  toE164Ng,
} from './deliveryQuote.service.js';
import {
  fetchShippingRates,
  nextPickupDate,
  pickCheapestShipbubbleCourier,
  resolveDocumentCategoryId,
  validateAddress,
} from './shipbubble.service.js';

export class ShipmentError extends Error {
  constructor(message, statusCode = 400, code = 'SHIPMENT_ERROR') {
    super(message);
    this.name = 'ShipmentError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function nairaToKobo(value) {
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

async function getExistingShipment({ orderId, guestOrderId }) {
  const supabase = getSupabaseAdmin();
  let query = supabase.from('shipments').select('*');
  if (guestOrderId) query = query.eq('guest_order_id', guestOrderId);
  else query = query.eq('order_id', orderId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw new ShipmentError('Failed to load shipment', 500, 'DB_ERROR');
  }
  return data || null;
}

export async function getShipmentForOrder({ orderId, guestOrderId, orderNumber }) {
  const supabase = getSupabaseAdmin();
  if (guestOrderId) {
    const { data } = await supabase.from('shipments').select('*').eq('guest_order_id', guestOrderId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  }
  if (orderId) {
    const { data } = await supabase.from('shipments').select('*').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  }
  if (orderNumber) {
    const { data } = await supabase.from('shipments').select('*').eq('order_number', orderNumber).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  }
  return null;
}

async function loadRenewalOrder(orderNumber) {
  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from('renewal_orders')
    .select(`
      *,
      cars:car_id ( registration_no, vehicle_make, vehicle_model ),
      payment_transactions:transaction_id ( status, payment_type, metadata, amount )
    `)
    .eq('order_number', orderNumber)
    .maybeSingle();
  if (error || !order) throw new ShipmentError('Order not found', 404, 'NOT_FOUND');
  return order;
}

async function loadGuestOrder(orderId) {
  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from('guest_renewal_orders')
    .select('*, guest_customers(name, email, phone)')
    .eq('id', orderId)
    .maybeSingle();
  if (error || !order) throw new ShipmentError('Guest order not found', 404, 'NOT_FOUND');
  return order;
}

async function loadProfile(userId) {
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, email, phone_number')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

function assertPaidRenewal(order) {
  const txStatus = order.payment_transactions?.status;
  const paid = txStatus === 'success' || txStatus === 'paid' || Number(order.amount_paid) > 0;
  if (!paid) throw new ShipmentError('Waybill can only be generated after payment', 400, 'NOT_PAID');
}

function assertHasDelivery(address, state, lga) {
  if (!address || !state || !lga) {
    throw new ShipmentError('This order has no delivery address', 400, 'NO_DELIVERY');
  }
}

function purposeFromOrderType(orderType) {
  if (orderType === 'plate_number') return 'plate_number';
  if (orderType === 'driver_license') return 'driver_license';
  return 'renewal';
}

function parseTerminalPickupResult(booked) {
  const extras = booked?.extras || {};
  const shipmentId = booked?.shipment_id || booked?.id || extras.tracking_number || null;
  return {
    shipmentId,
    trackingUrl: extras.tracking_url || extras.carrier_tracking_url || null,
    labelUrl: extras.shipping_label || extras.commercial_invoice || null,
    trackingNumber: extras.tracking_number || shipmentId,
    amountNaira: booked?.rate?.amount ?? booked?.amount ?? null,
  };
}

function parseShipbubbleLabelResult(booked) {
  return {
    shipmentId: booked?.order_id || null,
    trackingUrl: booked?.tracking_url || null,
    labelUrl: booked?.waybill_document || booked?.label_url || null,
    trackingNumber: booked?.courier?.tracking_code || booked?.order_id || null,
    amountNaira: booked?.payment?.shipping_fee ?? null,
    status: booked?.status || 'pending',
  };
}

function customerDeliveryFeeKobo(order, isGuest) {
  const n = Number(order?.delivery_fee);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (isGuest) return Math.round(n);
  return n >= 1000 ? Math.round(n) : Math.round(n * 100);
}

function pickupAttempted(row) {
  return Boolean(row?.raw_response?.pickup_attempted);
}

const BOOKING_LOCK_WAIT_MS = 2 * 60 * 1000;

function activeProvider() {
  if (isShipbubbleConfigured()) return 'shipbubble';
  if (isTerminalConfigured()) return 'terminal';
  return null;
}

async function bookViaShipbubble({
  stateName,
  deliveryLga,
  deliveryAddress,
  receiverName,
  receiverEmail,
  receiverPhone,
  purpose,
  weightKg,
}) {
  const pickup = pickupAddressPayload();
  const delivery = deliveryAddressPayload({
    stateName,
    city: deliveryLga || stateName,
    street: deliveryAddress,
    contact: receiverPhone,
    name: receiverName,
    email: receiverEmail,
  });

  const [senderValidated, receiverValidated, categoryId] = await Promise.all([
    process.env.SHIPBUBBLE_PICKUP_ADDRESS_CODE
      ? Promise.resolve({ address_code: process.env.SHIPBUBBLE_PICKUP_ADDRESS_CODE })
      : validateAddress({
          name: pickup.name || `${pickup.first_name} ${pickup.last_name}`.trim(),
          email: pickup.email,
          phone: pickup.phone,
          address: pickupAddressString(),
        }),
    validateAddress({
      name: delivery.name,
      email: delivery.email,
      phone: toE164Ng(receiverPhone) || delivery.phone,
      address: deliveryAddressString({
        stateName,
        city: deliveryLga || stateName,
        street: deliveryAddress,
      }),
    }),
    resolveDocumentCategoryId(),
  ]);

  const ratesPayload = await fetchShippingRates({
    senderAddressCode: senderValidated.address_code,
    receiverAddressCode: receiverValidated.address_code,
    categoryId,
    packageItems: shipbubblePackageItems({ purpose, weightKg }),
    packageDimension: shipbubblePackageDimension(),
    pickupDate: nextPickupDate(),
    serviceType: 'pickup',
    deliveryInstructions: `Motoka ${purpose} documents`,
  });

  const cheapest = pickCheapestShipbubbleCourier(ratesPayload);
  if (!cheapest?.service_code || cheapest.courier_id == null || !ratesPayload?.request_token) {
    throw new ShipmentError(
      'No Shipbubble courier rates are available for this destination.',
      400,
      'NO_RATES'
    );
  }

  return {
    cheapest,
    ratesPayload,
    amountNaira: Number(cheapest.total ?? cheapest.rate_card_amount),
    book: async () =>
      createShipmentLabel({
        requestToken: ratesPayload.request_token,
        serviceCode: cheapest.service_code,
        courierId: cheapest.courier_id,
      }),
  };
}

async function bookViaTerminal({
  stateName,
  deliveryLga,
  deliveryAddress,
  receiverName,
  receiverEmail,
  receiverPhone,
  purpose,
  weightKg,
}) {
  const packagingId = await getPackagingId();
  const rates = await getShipmentQuotes({
    pickupAddress: pickupAddressPayload(),
    deliveryAddress: deliveryAddressPayload({
      stateName,
      city: deliveryLga || stateName,
      street: deliveryAddress,
      contact: receiverPhone,
      name: receiverName,
      email: receiverEmail,
    }),
    parcel: parcelPayload({ purpose, weightKg, packagingId }),
    persistData: true,
  });

  const cheapest = pickCheapestNgnRate(rates);
  if (!cheapest?.rate_id && !cheapest?.id) {
    throw new ShipmentError(
      'No Terminal carrier rates are available for this destination.',
      400,
      'NO_RATES'
    );
  }

  return {
    cheapest,
    ratesPayload: rates,
    amountNaira: cheapest.amountNaira,
    book: async () =>
      arrangePickup({
        rateId: cheapest.rate_id || cheapest.id,
        shipmentId: cheapest.shipment || null,
      }),
  };
}

export async function createWaybill({
  orderType,
  orderNumber,
  guestOrderId,
  weightKg: weightOverride,
  adminId,
}) {
  const provider = activeProvider();
  if (!provider) {
    throw new ShipmentError(
      'No courier provider configured. Set SHIPBUBBLE_API_KEY (preferred) or TERMINAL_SECRET_KEY.',
      503,
      'CONFIG_ERROR'
    );
  }
  if (provider === 'shipbubble' && !isShipbubbleBookingEnabled()) {
    throw new ShipmentError(
      'Live Shipbubble booking is disabled. Fund the wallet, then set SHIPBUBBLE_BOOKING_ENABLED=true.',
      503,
      'BOOKING_DISABLED'
    );
  }
  if (provider === 'terminal' && !isTerminalBookingEnabled()) {
    throw new ShipmentError(
      'Live Terminal booking is disabled. Fund the Terminal wallet, then set TERMINAL_BOOKING_ENABLED=true.',
      503,
      'BOOKING_DISABLED'
    );
  }

  const supabase = getSupabaseAdmin();
  let order;
  let purpose;
  let deliveryAddress;
  let deliveryState;
  let deliveryLga;
  let receiverName;
  let receiverEmail;
  let receiverPhone;
  let orderId = null;
  let guestId = null;
  let selectedItems = [];

  if (orderType === 'guest_renewal' || guestOrderId) {
    order = await loadGuestOrder(guestOrderId);
    guestId = order.id;
    const paid = String(order.payment_status || '').toLowerCase() === 'payment_success';
    if (!paid) {
      throw new ShipmentError('Waybill can only be generated after payment', 400, 'NOT_PAID');
    }
    const details = order.delivery_details || {};
    deliveryAddress = details.address;
    deliveryState = details.state;
    deliveryLga = details.lga;
    receiverName = order.guest_name || order.guest_customers?.name || 'Guest';
    receiverEmail = order.guest_email || order.guest_customers?.email || '';
    receiverPhone = details.contact || order.guest_phone || order.guest_customers?.phone || '';
    purpose = 'renewal';
    selectedItems = order.selected_items || [];
    orderNumber = order.order_number || order.id;
  } else {
    order = await loadRenewalOrder(orderNumber);
    assertPaidRenewal(order);
    orderId = order.id;
    purpose = purposeFromOrderType(order.order_type);
    deliveryAddress = order.delivery_address;
    deliveryState = order.delivery_state;
    deliveryLga = order.delivery_lga;
    const profile = await loadProfile(order.user_id);
    receiverName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Customer';
    receiverEmail = profile?.email || '';
    receiverPhone = order.delivery_contact || profile?.phone_number || '';
    selectedItems = order.selected_items || [];
  }

  assertHasDelivery(deliveryAddress, deliveryState, deliveryLga);

  const existing = await getExistingShipment({ orderId, guestOrderId: guestId });
  if (existing?.waybill_number) {
    return existing;
  }
  if (existing && pickupAttempted(existing) && !existing.waybill_number) {
    throw new ShipmentError(
      'A courier booking was already attempted for this order. Check the Shipbubble/Terminal dashboard before retrying — a second click can charge the wallet twice.',
      409,
      'BOOKING_IN_PROGRESS'
    );
  }
  if (existing && existing.status === 'booking' && !existing.waybill_number) {
    const ageMs = Date.now() - new Date(existing.updated_at || existing.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs < BOOKING_LOCK_WAIT_MS) {
      throw new ShipmentError(
        'A waybill is already being generated for this order. Wait a moment and refresh.',
        409,
        'BOOKING_IN_PROGRESS'
      );
    }
  }

  let bookingRow = existing;
  if (!bookingRow) {
    const placeholder = {
      provider,
      order_type: guestId ? 'guest_renewal' : (order.order_type || purpose),
      order_id: orderId,
      guest_order_id: guestId,
      order_number: order.order_number || String(orderNumber),
      status: 'booking',
      created_by_admin_id: isUuid(adminId) ? adminId : null,
      updated_at: new Date().toISOString(),
    };
    const { data: inserted, error: insertError } = await supabase
      .from('shipments')
      .insert(placeholder)
      .select('*')
      .single();
    if (insertError?.code === '23505') {
      const raced = await getExistingShipment({ orderId, guestOrderId: guestId });
      if (raced?.waybill_number) return raced;
      throw new ShipmentError(
        'A waybill is already being generated for this order. Wait a moment and refresh.',
        409,
        'BOOKING_IN_PROGRESS'
      );
    }
    if (insertError) {
      throw new ShipmentError(insertError.message || 'Failed to lock shipment', 500, 'DB_ERROR');
    }
    bookingRow = inserted;
  }

  const motokaStates = await getAllStates();
  const motokaState = motokaStates.find((s) => s.code === deliveryState);
  const stateName = motokaState?.name || deliveryState;
  const estimated = estimateWeightKg({ purpose, selectedItems });
  const weightKg = toTerminalWeightKg(
    weightOverride != null && Number(weightOverride) > 0 ? weightOverride : estimated,
    estimated
  );

  let prepared;
  try {
    prepared = provider === 'shipbubble'
      ? await bookViaShipbubble({
          stateName,
          deliveryLga,
          deliveryAddress,
          receiverName,
          receiverEmail,
          receiverPhone,
          purpose,
          weightKg,
        })
      : await bookViaTerminal({
          stateName,
          deliveryLga,
          deliveryAddress,
          receiverName,
          receiverEmail,
          receiverPhone,
          purpose,
          weightKg,
        });
  } catch (error) {
    await supabase.from('shipments').delete().eq('id', bookingRow.id).is('waybill_number', null);
    if (
      error instanceof TerminalError ||
      error instanceof ShipbubbleError ||
      error instanceof DeliveryQuoteError ||
      error instanceof ShipmentError
    ) {
      throw new ShipmentError(error.message, error.statusCode || 502, error.code || 'API_ERROR');
    }
    throw error;
  }

  const bookedFeeKobo = nairaToKobo(prepared.amountNaira);
  const paidFeeKobo = customerDeliveryFeeKobo(order, Boolean(guestId));
  const feeMismatch = paidFeeKobo != null && bookedFeeKobo != null
    ? { customer_kobo: paidFeeKobo, booked_kobo: bookedFeeKobo, difference_kobo: bookedFeeKobo - paidFeeKobo }
    : null;

  await supabase
    .from('shipments')
    .update({
      raw_response: {
        pickup_attempted: true,
        provider,
        rate_id: prepared.cheapest?.rate_id || prepared.cheapest?.id || prepared.ratesPayload?.request_token || null,
        request_token: prepared.ratesPayload?.request_token || null,
        courier_id: prepared.cheapest?.courier_id ?? null,
        service_code: prepared.cheapest?.service_code || null,
        fee_mismatch: feeMismatch,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingRow.id);

  let booked;
  try {
    booked = await prepared.book();
  } catch (error) {
    throw new ShipmentError(
      error.message || 'Courier booking failed. Do not click Generate again until the courier dashboard is checked — the wallet may already have been charged.',
      error.statusCode || 502,
      error.code || 'PICKUP_FAILED'
    );
  }

  const parsed = provider === 'shipbubble'
    ? parseShipbubbleLabelResult(booked)
    : parseTerminalPickupResult(booked);

  if (!parsed.shipmentId && !parsed.trackingNumber) {
    throw new ShipmentError(
      'Courier booking did not return a waybill. Do not click Generate again — contact engineering and check the courier dashboard.',
      502,
      'API_ERROR'
    );
  }

  const row = {
    provider,
    order_type: guestId ? 'guest_renewal' : (order.order_type || purpose),
    order_id: orderId,
    guest_order_id: guestId,
    order_number: order.order_number || String(orderNumber),
    waybill_number: parsed.trackingNumber || parsed.shipmentId,
    tracking_url: parsed.trackingUrl,
    label_url: parsed.labelUrl,
    shipping_fee_kobo: parsed.amountNaira != null ? nairaToKobo(parsed.amountNaira) : bookedFeeKobo,
    weight_kg: weightKg,
    estimated_weight_kg: estimated,
    status: parsed.status || booked?.status || 'created',
    raw_response: {
      shipment_id: parsed.shipmentId,
      rate_id: prepared.cheapest?.rate_id || prepared.cheapest?.id || prepared.ratesPayload?.request_token || null,
      request_token: prepared.ratesPayload?.request_token || null,
      courier_id: prepared.cheapest?.courier_id ?? null,
      service_code: prepared.cheapest?.service_code || null,
      carrier_name: prepared.cheapest?.courier_name || prepared.cheapest?.carrier_name || null,
      pickup_attempted: true,
      fee_mismatch: feeMismatch,
      booked,
    },
    created_by_admin_id: isUuid(adminId) ? adminId : null,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await supabase
    .from('shipments')
    .update(row)
    .eq('id', bookingRow.id)
    .select('*')
    .single();
  if (error) {
    throw new ShipmentError(
      error.message || 'Courier was booked but Motoka failed to save the waybill. Do not click Generate again — contact engineering.',
      500,
      'DB_ERROR'
    );
  }
  return saved;
}

function shipmentIdFromRow(shipment) {
  return shipment?.raw_response?.shipment_id || shipment?.waybill_number;
}

export async function trackShipment(shipment) {
  const shipmentId = shipmentIdFromRow(shipment);
  if (!shipmentId) {
    throw new ShipmentError('No waybill to track', 400, 'NO_WAYBILL');
  }
  if (shipment?.provider === 'kxpress') {
    return { shipment, tracking: null };
  }
  if (shipment?.provider === 'shipbubble' || (isShipbubbleConfigured() && String(shipmentId).startsWith('SB-'))) {
    if (!isShipbubbleConfigured()) return { shipment, tracking: null };
    const live = await trackShipbubbleShipment(shipmentId);
    return { shipment, tracking: live };
  }
  if (!isTerminalConfigured()) {
    return { shipment, tracking: null };
  }
  const live = await trackTerminalShipment(shipmentId);
  return {
    shipment,
    tracking: live,
  };
}

/**
 * Apply a Shipbubble webhook payload onto the matching Motoka shipments row.
 * Looks up by Shipbubble order_id (SB-…) stored as waybill_number / raw_response.shipment_id.
 */
export async function applyShipbubbleWebhookEvent(payload = {}) {
  const orderId = payload.order_id || payload.data?.order_id || null;
  if (!orderId) {
    return { updated: false, reason: 'missing_order_id' };
  }

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('shipments')
    .select('*')
    .or(`waybill_number.eq.${orderId},waybill_number.eq.${payload.courier?.tracking_code || orderId}`)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    throw new ShipmentError(error.message || 'Failed to load shipment for webhook', 500, 'DB_ERROR');
  }

  let shipment = (rows || []).find((r) => {
    const sid = r?.raw_response?.shipment_id || r?.waybill_number;
    return String(sid) === String(orderId) || String(r?.waybill_number) === String(orderId);
  });

  if (!shipment) {
    // Fallback: scan recent shipbubble rows for matching shipment_id in JSON
    const { data: recent } = await supabase
      .from('shipments')
      .select('*')
      .eq('provider', 'shipbubble')
      .order('created_at', { ascending: false })
      .limit(40);
    shipment = (recent || []).find((r) => {
      const sid = r?.raw_response?.shipment_id || r?.waybill_number;
      const track = r?.raw_response?.booked?.courier?.tracking_code;
      return (
        String(sid) === String(orderId) ||
        String(r?.waybill_number) === String(orderId) ||
        (track && String(track) === String(payload.courier?.tracking_code || ''))
      );
    });
  }

  if (!shipment) {
    return { updated: false, reason: 'shipment_not_found', orderId };
  }

  const status = String(payload.status || 'pending').toLowerCase().replace(/\s+/g, '_');
  const trackingCode = payload.courier?.tracking_code || shipment.waybill_number;
  const trackingUrl = payload.tracking_url || shipment.tracking_url;
  const labelUrl = payload.waybill_document || shipment.label_url;
  const prevRaw = shipment.raw_response && typeof shipment.raw_response === 'object'
    ? shipment.raw_response
    : {};

  const packageStatus = Array.isArray(payload.package_status) ? payload.package_status : [];
  const events = Array.isArray(payload.events) ? payload.events : [];

  const patch = {
    status,
    waybill_number: trackingCode || shipment.waybill_number || orderId,
    tracking_url: trackingUrl,
    label_url: labelUrl,
    raw_response: {
      ...prevRaw,
      shipment_id: orderId,
      pickup_attempted: true,
      last_webhook_event: payload.event || 'shipment.status.changed',
      last_webhook_at: new Date().toISOString(),
      webhook: payload,
      package_status: packageStatus,
      events,
      courier_name: payload.courier?.name || prevRaw.carrier_name || prevRaw.courier_name || null,
    },
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error: updateError } = await supabase
    .from('shipments')
    .update(patch)
    .eq('id', shipment.id)
    .select('*')
    .single();

  if (updateError) {
    throw new ShipmentError(updateError.message || 'Failed to update shipment from webhook', 500, 'DB_ERROR');
  }

  return {
    updated: true,
    shipmentId: saved.id,
    orderId,
    status: saved.status,
  };
}
