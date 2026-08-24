import * as response from '../utils/responses.js';
import { paymentResponse } from './payment/payment-response.util.js';
import { logError } from '../utils/logger.js';
import { quoteDelivery, DeliveryQuoteError } from '../services/courier/deliveryQuote.service.js';
import { TerminalError } from '../services/courier/terminal.service.js';
import {
  createWaybill,
  getShipmentForOrder,
  ShipmentError,
} from '../services/courier/shipment.service.js';
import {
  getDeliveryProgressForOrder,
  getDeliveryProgressForGuestOrder,
  loadGuestOrder,
} from '../services/courier/deliveryProgress.service.js';
import { getOrderByNumber } from '../services/payment/order.service.js';

function mapError(res, error, usePaymentShape = false) {
  const reply = usePaymentShape ? paymentResponse : response;
  if (error instanceof DeliveryQuoteError || error instanceof TerminalError || error instanceof ShipmentError) {
    const status = error.statusCode || 400;
    if (status === 404) return reply.notFound(res, error.message);
    return reply.error(res, error.message, status);
  }
  logError('[Delivery] unexpected error', { error: error.message, stack: error.stack });
  return reply.serverError(res, 'Delivery service is temporarily unavailable');
}

function parseQuoteBody(body = {}) {
  const purpose = body.purpose || 'renewal';
  const state = body.state_id !== undefined && body.state_id !== null && body.state_id !== ''
    ? body.state_id
    : body.state;
  const lga = body.lga_id !== undefined && body.lga_id !== null && body.lga_id !== ''
    ? body.lga_id
    : body.lga;
  const selectedItems = body.selected_items || body.payment_schedule_id || [];
  return { purpose, state, lga, selectedItems };
}

export const quoteDeliveryHandler = async (req, res) => {
  try {
    const { purpose, state, lga, selectedItems } = parseQuoteBody(req.body);
    if (state == null || state === '' || lga == null || lga === '') {
      return paymentResponse.error(res, 'state and lga are required', 400);
    }
    const quote = await quoteDelivery({
      stateInput: state,
      lgaInput: lga,
      purpose,
      selectedItems,
    });
    return paymentResponse.success(res, quote, 'Delivery quote retrieved');
  } catch (error) {
    return mapError(res, error, true);
  }
};

export const publicQuoteDeliveryHandler = async (req, res) => {
  try {
    const { purpose, state, lga, selectedItems } = parseQuoteBody(req.body);
    if (state == null || state === '' || lga == null || lga === '') {
      return response.error(res, 'state and lga are required', 400);
    }
    const quote = await quoteDelivery({
      stateInput: state,
      lgaInput: lga,
      purpose: purpose === 'plate_number' || purpose === 'driver_license' ? purpose : 'renewal',
      selectedItems,
    });
    return response.success(res, quote, 'Delivery quote retrieved');
  } catch (error) {
    return mapError(res, error, false);
  }
};

export const userTrackOrderHandler = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await getOrderByNumber(orderNumber);
    if (!order) return paymentResponse.notFound(res, 'Order not found');
    if (order.user_id !== req.user.id) return paymentResponse.forbidden(res, 'Unauthorized');
    const payload = await getDeliveryProgressForOrder(order);
    return paymentResponse.success(res, payload, 'Tracking retrieved');
  } catch (error) {
    return mapError(res, error, true);
  }
};

export const guestTrackOrderHandler = async (req, res) => {
  try {
    const { orderId } = req.params;
    const token = String(req.query.token || '').trim();
    if (!token) {
      return response.notFound(res, 'Order not found');
    }
    const guestOrder = await loadGuestOrder(orderId);
    if (!guestOrder || guestOrder.receipt_token !== token) {
      return response.notFound(res, 'Order not found');
    }
    const payload = await getDeliveryProgressForGuestOrder(guestOrder);
    return response.success(res, payload, 'Tracking retrieved');
  } catch (error) {
    return mapError(res, error, false);
  }
};

export const adminCreateShipmentHandler = async (req, res) => {
  try {
    const { order_type, order_number, guest_order_id, weight_kg } = req.body || {};
    if (!order_number && !guest_order_id) {
      return response.error(res, 'order_number or guest_order_id is required', 400);
    }
    const shipment = await createWaybill({
      orderType: order_type || (guest_order_id ? 'guest_renewal' : 'renewal'),
      orderNumber: order_number,
      guestOrderId: guest_order_id,
      weightKg: weight_kg,
      adminId: req.admin?.id || null,
    });
    return response.created(res, shipment, 'Waybill generated');
  } catch (error) {
    return mapError(res, error, false);
  }
};

export const adminTrackShipmentHandler = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await getOrderByNumber(orderNumber);
    if (order) {
      const payload = await getDeliveryProgressForOrder(order, { includeLabel: true });
      return response.success(res, payload, 'Tracking retrieved');
    }
    const shipment = await getShipmentForOrder({ orderNumber });
    if (!shipment) {
      return response.success(res, { shipment: null, tracking: null, progress: null }, 'No shipment yet');
    }
    const guestOrder = shipment.guest_order_id
      ? await loadGuestOrder(shipment.guest_order_id)
      : null;
    if (guestOrder) {
      const payload = await getDeliveryProgressForGuestOrder(guestOrder, { includeLabel: true });
      return response.success(res, payload, 'Tracking retrieved');
    }
    return response.success(res, { shipment, tracking: null, progress: null }, 'Tracking retrieved');
  } catch (error) {
    return mapError(res, error, false);
  }
};
