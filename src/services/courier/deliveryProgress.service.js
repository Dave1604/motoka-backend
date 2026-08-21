import { getShipmentForOrder, trackShipment } from './shipment.service.js';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';

const DELIVERY_STEPS = [
  {
    key: 'paid',
    label: 'Payment received',
    description: 'We received your payment for this order.',
  },
  {
    key: 'processing',
    label: 'Documents in progress',
    description: 'Motoka is preparing your documents for dispatch.',
  },
  {
    key: 'booked',
    label: 'Courier booked',
    description: 'A waybill has been generated and pickup is arranged.',
  },
  {
    key: 'in_transit',
    label: 'On the way',
    description: 'Your package is with the courier.',
  },
  {
    key: 'delivered',
    label: 'Delivered',
    description: 'The courier marked this package as delivered.',
  },
];

const DOCS_ONLY_STEPS = [
  DELIVERY_STEPS[0],
  DELIVERY_STEPS[1],
  {
    key: 'ready',
    label: 'Documents ready',
    description: 'Your documents are ready. No courier delivery was requested.',
  },
];

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

export function hasDeliveryDetails(order = {}) {
  const details = asObject(order.delivery_details);
  const fee = Number(order.delivery_fee ?? order.delivery_fee_kobo ?? 0);
  return Boolean(
    order.delivery_address ||
    details.address ||
    (Number.isFinite(fee) && fee > 0)
  );
}

function courierStatus(tracking, shipment) {
  const raw =
    tracking?.status ||
    tracking?.tracking_status?.status ||
    tracking?.tracking_status ||
    shipment?.status ||
    '';
  return String(raw).toLowerCase().replace(/_/g, '-');
}

export function mapCourierStage(tracking, shipment) {
  if (!shipment?.waybill_number) return null;
  const status = courierStatus(tracking, shipment);
  if (status === 'delivered') return 'delivered';
  if (
    status === 'in-transit' ||
    status === 'in transit' ||
    status === 'picked-up' ||
    status === 'picked up' ||
    status === 'out-for-delivery' ||
    status === 'out for delivery'
  ) {
    return 'in_transit';
  }
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'booked';
}

function orderWorkflowStatus(order, guestOrder) {
  if (guestOrder) {
    const paid = String(guestOrder.payment_status || '').toLowerCase() === 'payment_success';
    return paid ? 'processing' : null;
  }
  return order?.status || null;
}

export function buildDeliveryProgress({ order = null, guestOrder = null, shipment = null, tracking = null } = {}) {
  const source = order || guestOrder || {};
  const delivery = hasDeliveryDetails(source);
  const workflow = orderWorkflowStatus(order, guestOrder);
  const cancelledOrder = workflow === 'cancelled';
  const courier = mapCourierStage(tracking, shipment);
  const courierCancelled = courier === 'cancelled';

  let currentKey = 'paid';
  if (cancelledOrder) {
    currentKey = workflow === 'cancelled' && !shipment?.waybill_number ? 'paid' : (courier || 'processing');
  } else if (!delivery) {
    if (workflow === 'completed') currentKey = 'ready';
    else if (workflow === 'processing') currentKey = 'processing';
    else currentKey = 'paid';
  } else if (courier === 'delivered') {
    currentKey = 'delivered';
  } else if (courier === 'in_transit') {
    currentKey = 'in_transit';
  } else if (shipment?.waybill_number) {
    currentKey = 'booked';
  } else if (workflow === 'processing' || workflow === 'completed') {
    currentKey = 'processing';
  }

  const catalog = delivery ? DELIVERY_STEPS : DOCS_ONLY_STEPS;
  const currentIndex = Math.max(0, catalog.findIndex((step) => step.key === currentKey));
  const steps = catalog.map((step, index) => ({
    ...step,
    done: !cancelledOrder && index < currentIndex,
    current: !cancelledOrder && index === currentIndex,
  }));

  const current = catalog[currentIndex] || catalog[0];
  const extras = asObject(tracking?.extras);
  const events = Array.isArray(tracking?.events)
    ? tracking.events
        .map((event) => ({
          at: event.created_at || event.datetime || event.timestamp || null,
          status: event.status || null,
          location: event.location || null,
          description: event.description || event.message || null,
        }))
        .filter((event) => event.description || event.status)
    : [];

  return {
    has_delivery: delivery,
    current_key: current.key,
    current_label: current.label,
    current_description: current.description,
    order_status: workflow,
    order_number: source.order_number || null,
    cancelled: cancelledOrder || courierCancelled,
    waybill_number: shipment?.waybill_number || null,
    tracking_url:
      shipment?.tracking_url ||
      extras.tracking_url ||
      extras.carrier_tracking_url ||
      null,
    carrier_name: shipment?.raw_response?.carrier_name || tracking?.carrier?.name || tracking?.carrier_name || null,
    events,
    steps,
  };
}

export function publicShipmentView(shipment, { includeLabel = false } = {}) {
  if (!shipment) return null;
  return {
    waybill_number: shipment.waybill_number || null,
    tracking_url: shipment.tracking_url || null,
    label_url: includeLabel ? shipment.label_url || null : null,
    status: shipment.status || null,
    weight_kg: shipment.weight_kg != null ? Number(shipment.weight_kg) : null,
    created_at: shipment.created_at || null,
    carrier_name: shipment.raw_response?.carrier_name || null,
  };
}

export function publicTrackingView(tracking) {
  if (!tracking) return null;
  const extras = asObject(tracking.extras);
  return {
    status: tracking.status || tracking.tracking_status?.status || null,
    carrier_tracking_number: tracking.carrier_tracking_number || extras.tracking_number || null,
    events: Array.isArray(tracking.events) ? tracking.events : [],
  };
}

async function liveTrack(shipment) {
  if (!shipment?.waybill_number) return { shipment, tracking: null };
  try {
    return await trackShipment(shipment);
  } catch (error) {
    logError('[Delivery] live tracking unavailable', { message: error.message, waybill: shipment.waybill_number });
    return { shipment, tracking: null };
  }
}

export async function getDeliveryProgressForOrder(order, { includeLabel = false } = {}) {
  const shipment = await getShipmentForOrder({
    orderId: order?.id,
    orderNumber: order?.order_number,
  });
  const live = await liveTrack(shipment);
  return {
    shipment: publicShipmentView(live.shipment, { includeLabel }),
    tracking: publicTrackingView(live.tracking),
    progress: buildDeliveryProgress({
      order,
      shipment: live.shipment,
      tracking: live.tracking,
    }),
  };
}

export async function getDeliveryProgressForGuestOrder(guestOrder, { includeLabel = false } = {}) {
  const shipment = await getShipmentForOrder({ guestOrderId: guestOrder?.id });
  const live = await liveTrack(shipment);
  return {
    shipment: publicShipmentView(live.shipment, { includeLabel }),
    tracking: publicTrackingView(live.tracking),
    progress: buildDeliveryProgress({
      guestOrder,
      shipment: live.shipment,
      tracking: live.tracking,
    }),
  };
}

export async function loadGuestOrder(orderId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, payment_status, delivery_fee, delivery_details, receipt_token')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
