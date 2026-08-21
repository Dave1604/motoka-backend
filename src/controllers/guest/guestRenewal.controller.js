/**
 * GUEST RENEWAL CONTROLLER
 *
 * Handles the full unauthenticated guest renewal lifecycle:
 *   POST /api/guest/renewals              — initiate payment
 *   GET  /api/guest/renewals/:orderId/status  — poll payment status
 *   GET  /api/guest/renewals/:orderId/receipt — fetch receipt (requires receipt_token)
 */

import * as response from '../../utils/responses.js';
import { logError } from '../../utils/logger.js';
import {
  initiateGuestRenewal,
  getGuestOrderStatus,
  getGuestReceipt,
  verifyGuestPayment,
  resendGuestReceipt
} from '../../services/guest/guestRenewal.service.js';
import { PAYMENT_GATEWAY } from '../../constants/payment.constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/guest/renewals
// ─────────────────────────────────────────────────────────────────────────────

export const initGuestRenewal = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      plate_number,
      expiry_date,
      selected_items,
      wants_delivery = false,
      delivery_details,
      payment_gateway,
      renewal_state = null
    } = req.body;

    // ── Basic field validation ───────────────────────────────────────────────
    const missing = [];
    if (!name?.trim()) missing.push('name');
    if (!email?.trim()) missing.push('email');
    if (!phone?.trim()) missing.push('phone');
    if (!plate_number?.trim()) missing.push('plate_number');
    if (!expiry_date) missing.push('expiry_date');
    if (!Array.isArray(selected_items) || selected_items.length === 0) missing.push('selected_items');

    if (missing.length) {
      return response.error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    // ── Validate email format ────────────────────────────────────────────────
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return response.error(res, 'Invalid email address', 400);
    }

    // ── Validate payment gateway ─────────────────────────────────────────────
    const rawGateway = payment_gateway?.toLowerCase();
    let gateway = rawGateway || PAYMENT_GATEWAY.MONIPAY;
    if (gateway === PAYMENT_GATEWAY.MONICREDIT) gateway = PAYMENT_GATEWAY.MONIPAY;
    if (gateway !== PAYMENT_GATEWAY.MONIPAY && gateway !== PAYMENT_GATEWAY.PAYSTACK) {
      return response.error(res, 'payment_gateway must be "monipay" or "paystack"', 400);
    }

    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const result = await initiateGuestRenewal({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      plateNumber: plate_number.trim().toUpperCase(),
      expiryDate: expiry_date,
      selectedItems: selected_items,
      wantsDelivery: !!wants_delivery,
      deliveryDetails: wants_delivery ? delivery_details : null,
      paymentGateway: gateway,
      frontendBaseUrl,
      renewalState: renewal_state || null
    });

    return response.success(res, result, 'Payment initialized successfully');
  } catch (error) {
    if (error.statusCode === 400) {
      return response.error(res, error.message, 400);
    }
    logError('[GuestRenewal] initGuestRenewal error', error);
    return response.serverError(res, 'Failed to initialize guest renewal');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/guest/renewals/:orderId/status
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await getGuestOrderStatus(orderId);

    if (!order) {
      return response.notFound(res, 'Guest renewal order not found');
    }

    return response.success(res, {
      orderId: order.id,
      paymentStatus: order.payment_status,
      paymentReference: order.payment_reference,
      gateway: order.payment_gateway,
      totalAmount: order.total_amount / 100,
      expiresAt: order.expires_at,
      isExpired: !!order.isExpired,
      hasLinkedAccount: !!order.linked_user_id,
      // Expose receipt token only after payment succeeds so client can access the receipt
      ...(order.payment_status === 'payment_success' ? { receiptToken: order.receipt_token } : {})
    }, 'Order status retrieved');
  } catch (error) {
    logError('[GuestRenewal] getOrderStatus error', error);
    return response.serverError(res, 'Failed to retrieve order status');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/guest/renewals/:orderId/verify
// Body: { reference } — calls gateway API directly to confirm payment status
// Used by the callback page as a webhook fallback (Paystack redirect flow)
// ─────────────────────────────────────────────────────────────────────────────

export const verifyOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reference } = req.body;

    const result = await verifyGuestPayment(orderId, reference);

    return response.success(res, result, 'Payment status checked');
  } catch (error) {
    if (error.statusCode === 404) {
      return response.notFound(res, error.message);
    }
    if (error.statusCode === 410) {
      return response.error(res, error.message, 410);
    }
    if (error.statusCode === 400) {
      return response.error(res, error.message, 400);
    }
    logError('[GuestRenewal] verifyOrder error', error);
    return response.serverError(res, 'Failed to verify payment');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/guest/receipt/resend
// Body: { email } — finds the latest paid order for this email and resends the
// confirmation email with the receipt link. Always returns 200 to avoid
// leaking whether an email exists in our system.
// ─────────────────────────────────────────────────────────────────────────────

export const resendReceipt = async (req, res) => {
  try {
    const { email } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email?.trim() || !emailRegex.test(email)) {
      return response.error(res, 'A valid email address is required', 400);
    }

    // Fire-and-forget — never reveal whether email exists
    resendGuestReceipt(email.trim().toLowerCase()).catch(() => {});

    return response.success(
      res,
      null,
      "If we found a receipt for that email, we've sent it to you."
    );
  } catch (error) {
    logError('[GuestRenewal] resendReceipt error', error);
    return response.serverError(res, 'Failed to process request');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/guest/renewals/:orderId/receipt?token=...
// ─────────────────────────────────────────────────────────────────────────────

export const getReceipt = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { token } = req.query;

    if (!token) {
      return response.error(res, 'Receipt token is required', 400);
    }

    const receipt = await getGuestReceipt(orderId, token);

    if (!receipt) {
      return response.notFound(res, 'Receipt not found or payment not yet confirmed');
    }

    return response.success(res, receipt, 'Receipt retrieved');
  } catch (error) {
    logError('[GuestRenewal] getReceipt error', error);
    return response.serverError(res, 'Failed to retrieve receipt');
  }
};
