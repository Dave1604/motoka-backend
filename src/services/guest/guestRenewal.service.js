/**
 * GUEST RENEWAL SERVICE
 *
 * Core business logic for the unauthenticated guest renewal flow:
 *  1. Validate input and compute pricing (never trust client totals)
 *  2. Upsert a guest_customer record
 *  3. Create a guest_renewal_order in status "pending_payment"
 *  4. Call the selected payment gateway (MoniCredit or Paystack) directly,
 *     bypassing the authenticated adapters that require a user profile from DB
 *  5. Expose helpers for status polling, receipt retrieval, and webhook updates
 */

import crypto from 'crypto';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo, logDebug } from '../../utils/logger.js';
import { getRenewalItems, validateRenewalItemsSelection } from '../payment/renewalItems.service.js';
import { resolveStateAndLGA } from '../location.service.js';
import { generatePaymentReference } from '../../utils/paymentHelpers.js';
import { initializeTransaction as monicreditInit, verifyTransaction as monicreditVerify, MonicreditError } from '../payment/monicredit/monicredit.service.js';
import { MonicreditNormalizer } from '../payment/monicredit/monicredit.normalizer.js';
import { initializeTransaction as paystackInit, verifyTransaction as paystackVerify, PaystackError } from '../payment/paystack.service.js';
import { PAYMENT_GATEWAY } from '../../constants/payment.constants.js';
import { sendGuestPaymentConfirmationEmail } from '../email/paymentEmail.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateReceiptToken() {
  return crypto.randomBytes(24).toString('hex');
}

function splitName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || 'Guest';
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

// ─── Main: initiate guest payment ────────────────────────────────────────────

/**
 * Creates a guest renewal order and initialises payment with the selected gateway.
 *
 * @param {Object} params
 * @param {string} params.name            - Guest full name
 * @param {string} params.email           - Guest email
 * @param {string} params.phone           - Guest phone (digits, no +234 prefix expected)
 * @param {string} params.plateNumber     - Vehicle plate number
 * @param {string} params.expiryDate      - Vehicle last expiry date (YYYY-MM-DD)
 * @param {string[]} params.selectedItems - Array of renewal item_key strings
 * @param {boolean} params.wantsDelivery  - Whether delivery is requested
 * @param {Object} [params.deliveryDetails]
 * @param {string} params.deliveryDetails.address
 * @param {string} params.deliveryDetails.state  - State code e.g. "LA"
 * @param {string} params.deliveryDetails.lga    - LGA name
 * @param {string} params.deliveryDetails.contact
 * @param {string} params.paymentGateway  - "monicredit" | "paystack"
 * @param {string} params.frontendBaseUrl - Used to build callback URL
 * @returns {Promise<Object>} { orderId, paymentReference, paymentUrl, expiresAt, gateway }
 */
export async function initiateGuestRenewal({
  name,
  email,
  phone,
  plateNumber,
  expiryDate,
  selectedItems,
  wantsDelivery,
  deliveryDetails,
  paymentGateway = PAYMENT_GATEWAY.MONICREDIT,
  frontendBaseUrl
}) {
  const supabase = getSupabaseAdmin();

  // ── 1. Validate selected renewal items and compute renewal amount ──────────
  const validation = await validateRenewalItemsSelection(selectedItems);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { statusCode: 400 });
  }
  const renewalAmount = validation.total; // in kobo

  // ── 2. Resolve delivery state/LGA and delivery fee ─────────────────────────
  let deliveryFee = 0;
  let resolvedDelivery = null;

  if (wantsDelivery) {
    if (!deliveryDetails?.address || !deliveryDetails?.state || !deliveryDetails?.lga || !deliveryDetails?.contact) {
      throw Object.assign(
        new Error('Delivery requires address, state, lga, and contact'),
        { statusCode: 400 }
      );
    }
    const resolved = await resolveStateAndLGA(
      deliveryDetails.state,
      deliveryDetails.lga
    );
    if (!resolved.valid) {
      throw Object.assign(new Error(resolved.error), { statusCode: 400 });
    }
    deliveryFee = resolved.delivery_fee; // in kobo
    resolvedDelivery = {
      address: deliveryDetails.address,
      state: resolved.stateCode,
      lga: resolved.lgaName,
      contact: deliveryDetails.contact,
      fee: deliveryFee
    };
  }

  const totalAmount = renewalAmount + deliveryFee;

  // ── 3. Upsert guest_customer (by email + plate) ────────────────────────────
  // Use ON CONFLICT so this is an atomic upsert — no race condition between
  // SELECT and INSERT when the same guest submits concurrently.
  const { data: customer, error: upsertError } = await supabase
    .from('guest_customers')
    .upsert(
      {
        name,
        email: email.toLowerCase(),
        phone,
        plate_number: plateNumber.toUpperCase(),
        updated_at: new Date().toISOString()
      },
      { onConflict: 'email,plate_number', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (upsertError) {
    logError('[GuestRenewal] Failed to upsert guest customer', upsertError);
    throw Object.assign(new Error('Failed to create guest record'), { statusCode: 500 });
  }

  const guestCustomerId = customer.id;

  // ── 4. Create guest_renewal_order in pending_payment ──────────────────────
  const paymentReference = generatePaymentReference();
  const receiptToken = generateReceiptToken();

  const { data: order, error: orderError } = await supabase
    .from('guest_renewal_orders')
    .insert({
      guest_customer_id: guestCustomerId,
      guest_name: name,
      guest_email: email.toLowerCase(),
      guest_phone: phone,
      plate_number: plateNumber.toUpperCase(),
      expiry_date: expiryDate,
      selected_items: selectedItems,
      renewal_amount: renewalAmount,
      delivery_fee: deliveryFee,
      total_amount: totalAmount,
      delivery_details: resolvedDelivery,
      payment_gateway: paymentGateway,
      payment_reference: paymentReference,
      payment_status: 'pending_payment',
      receipt_token: receiptToken,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    })
    .select('*')
    .single();

  if (orderError) {
    logError('[GuestRenewal] Failed to create guest order', orderError);
    throw Object.assign(new Error('Failed to create renewal order'), { statusCode: 500 });
  }

  logInfo('[GuestRenewal] Order created', { orderId: order.id, reference: paymentReference });

  // ── 5. Initialise payment with gateway ────────────────────────────────────
  const { firstName, lastName } = splitName(name);

  const callbackUrl = `${frontendBaseUrl}/guest/renewal/callback`;

  let gatewayResult;

  if (paymentGateway === PAYMENT_GATEWAY.PAYSTACK) {
    gatewayResult = await _initPaystack({
      email,
      amount: totalAmount,
      reference: paymentReference,
      callbackUrl,
      name,
      plateNumber,
      selectedItems,
      deliveryDetails: resolvedDelivery
    });
  } else {
    gatewayResult = await _initMonicredit({
      email,
      firstName,
      lastName,
      phone,
      reference: paymentReference,
      selectedItems,
      renewalAmount,
      deliveryFee,
      resolvedDelivery,
      plateNumber
    });
  }

  // ── 6. Persist gateway-returned URL back onto the order ───────────────────
  await supabase
    .from('guest_renewal_orders')
    .update({
      payment_url: gatewayResult.payment_url || gatewayResult.authorization_url || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', order.id);

  const paymentUrl = gatewayResult.payment_url || gatewayResult.authorization_url || null;

  return {
    orderId: order.id,
    paymentReference,
    paymentUrl,
    expiresAt: order.expires_at,
    gateway: paymentGateway,
    totalAmount: totalAmount / 100,
    ...(paymentGateway === PAYMENT_GATEWAY.MONICREDIT ? {
      accountNumber: gatewayResult.account_number,
      bankName: gatewayResult.bank_name,
      accountName: gatewayResult.account_name,
    } : {
      accessCode: gatewayResult.access_code
    })
  };
}

// ─── Gateway initialisation helpers (direct API calls, no auth-user lookup) ──

async function _initPaystack({ email, amount, reference, callbackUrl, name, plateNumber, selectedItems, deliveryDetails }) {
  const metadata = {
    is_guest: true,
    guest_name: name,
    guest_plate: plateNumber,
    selected_items: selectedItems,
    delivery_details: deliveryDetails,
    custom_fields: [
      { display_name: 'Plate Number', variable_name: 'plate_number', value: plateNumber },
      { display_name: 'Customer', variable_name: 'customer', value: name }
    ]
  };

  return paystackInit({ email, amount, reference, callback_url: callbackUrl, metadata });
}

async function _initMonicredit({ email, firstName, lastName, phone, reference, selectedItems, renewalAmount, deliveryFee, resolvedDelivery, plateNumber }) {
  const allItems = await getRenewalItems();
  const itemMap = new Map(allItems.map(item => [item.id, item]));

  // MoniCredit rejects any line item with unit_cost < 50 Naira.
  // Zero-price items (e.g. "Keeping Digital Copy") are excluded from the
  // payment request; they are still stored on the order for record-keeping.
  const lineItems = selectedItems
    .map(id => {
      const item = itemMap.get(id);
      return {
        item: item?.name || id,
        unit_cost: (item?.price || 0) / 100,
        quantity: 1
      };
    })
    .filter(li => li.unit_cost > 0);

  if (resolvedDelivery && deliveryFee > 0) {
    lineItems.push({
      item: 'Delivery Fee',
      unit_cost: deliveryFee / 100,
      quantity: 1
    });
  }

  const totalNaira = lineItems.reduce((sum, i) => sum + i.unit_cost, 0);

  const normalizedPhone = phone.startsWith('0') ? `+234${phone.slice(1)}` : phone;

  const customer = {
    email,
    first_name: firstName,
    last_name: lastName,
    phone: normalizedPhone
  };

  const metaData = {
    is_guest: true,
    plate_number: plateNumber,
    ...(resolvedDelivery ? {
      delivery_address: resolvedDelivery.address,
      delivery_state: resolvedDelivery.state,
      delivery_lga: resolvedDelivery.lga,
      delivery_contact: resolvedDelivery.contact
    } : {})
  };

  const rawResponse = await monicreditInit({
    order_id: reference,
    customer,
    items: lineItems,
    total_amount: totalNaira,
    meta_data: metaData
  });

  return MonicreditNormalizer.normalizeInitResponse(rawResponse);
}

// ─── Status polling ────────────────────────────────────────────────────────────

/**
 * Returns the current status of a guest renewal order.
 * Used by the frontend callback page to poll after redirect.
 */
export async function getGuestOrderStatus(orderId) {
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, payment_status, payment_reference, payment_gateway, total_amount, receipt_token, expires_at, guest_email, guest_name, plate_number, linked_user_id')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return null;
  }

  // If the order is still pending and past its TTL, surface that so the
  // frontend can stop polling and show the "resend receipt" prompt.
  const isExpired =
    order.payment_status === 'pending_payment' &&
    new Date(order.expires_at) < new Date();

  return { ...order, isExpired };
}

// ─── Receipt ──────────────────────────────────────────────────────────────────

/**
 * Returns full receipt data for a paid guest order.
 * Protected by receipt_token so unauthenticated users can only access their own receipt.
 */
export async function getGuestReceipt(orderId, receiptToken) {
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from('guest_renewal_orders')
    .select('*, guest_customers(name, email, phone)')
    .eq('id', orderId)
    .eq('receipt_token', receiptToken)
    .maybeSingle();

  if (error || !order) {
    return null;
  }

  if (order.payment_status !== 'payment_success') {
    return null;
  }

  // Enrich with item name details
  const allItems = await getRenewalItems();
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  const enrichedItems = (order.selected_items || []).map(id => itemMap.get(id) || { id, name: id, price: 0 });

  return {
    orderId: order.id,
    reference: order.payment_reference,
    gateway: order.payment_gateway,
    guestName: order.guest_name,
    guestEmail: order.guest_email,
    guestPhone: order.guest_phone,
    plateNumber: order.plate_number,
    expiryDate: order.expiry_date,
    selectedItems: enrichedItems,
    renewalAmount: order.renewal_amount,
    deliveryFee: order.delivery_fee,
    totalAmount: order.total_amount,
    deliveryDetails: order.delivery_details,
    paidAt: order.updated_at,
    hasLinkedAccount: !!order.linked_user_id
  };
}

// ─── Webhook: mark order as paid ─────────────────────────────────────────────

/**
 * Called from the webhook handler when payment for a guest reference succeeds.
 * Marks the guest_renewal_order as payment_success.
 */
export async function markGuestOrderPaid(paymentReference) {
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, payment_status, guest_email, guest_name, total_amount, selected_items, receipt_token')
    .eq('payment_reference', paymentReference)
    .maybeSingle();

  if (error || !order) {
    logError('[GuestRenewal] markGuestOrderPaid: order not found', { paymentReference });
    return null;
  }

  if (order.payment_status === 'payment_success') {
    logDebug('[GuestRenewal] Already marked paid, skipping', { orderId: order.id });
    return order;
  }

  const { error: updateError } = await supabase
    .from('guest_renewal_orders')
    .update({ payment_status: 'payment_success', updated_at: new Date().toISOString() })
    .eq('id', order.id);

  if (updateError) {
    logError('[GuestRenewal] Failed to mark order paid', updateError);
    return null;
  }

  logInfo('[GuestRenewal] Order marked as payment_success', { orderId: order.id, reference: paymentReference });

  // Auto-link to existing account if the guest email belongs to a registered user.
  // Done silently — a failure here must never block payment confirmation.
  try {
    // profiles.id = auth.users.id; query by email is fast and avoids non-existent getUserByEmail
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', order.guest_email.toLowerCase())
      .maybeSingle();
    const existingUser = existingProfile ? { id: existingProfile.id } : null;
    if (existingUser?.id) {
      await supabase
        .from('guest_renewal_orders')
        .update({ linked_user_id: existingUser.id, updated_at: new Date().toISOString() })
        .eq('id', order.id);
      logInfo('[GuestRenewal] Auto-linked order to existing account', { orderId: order.id, userId: existingUser.id });
    }
  } catch (linkErr) {
    logError('[GuestRenewal] Auto-link check failed (non-fatal)', { error: linkErr.message, orderId: order.id });
  }

  // Send confirmation email — fire-and-forget so a mail failure never blocks the payment flow
  try {
    const allItems = await getRenewalItems();
    const itemMap = new Map(allItems.map(i => [i.id, i]));
    const documentNames = (order.selected_items || [])
      .map(id => itemMap.get(id)?.name)
      .filter(Boolean);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const receiptUrl = `${frontendUrl}/guest/renewal/receipt?orderId=${order.id}&token=${order.receipt_token}`;

    await sendGuestPaymentConfirmationEmail({
      to: order.guest_email,
      guestName: order.guest_name,
      reference: paymentReference,
      amount: order.total_amount,
      plateNumber: order.plate_number,
      documentNames,
      receiptUrl
    });
  } catch (emailErr) {
    logError('[GuestRenewal] Failed to send confirmation email', { error: emailErr.message, orderId: order.id });
  }

  return order;
}

/**
 * Called from the webhook handler when payment for a guest reference fails.
 */
export async function markGuestOrderFailed(paymentReference) {
  const supabase = getSupabaseAdmin();

  await supabase
    .from('guest_renewal_orders')
    .update({ payment_status: 'payment_failed', updated_at: new Date().toISOString() })
    .eq('payment_reference', paymentReference);
}

// ─── Active verification (used by callback page as webhook fallback) ──────────

/**
 * Directly verifies a guest payment with the gateway API and marks the order
 * paid/failed accordingly. Used by the frontend callback page so Paystack
 * (redirect-based) works without relying solely on webhooks.
 *
 * @param {string} orderId  - guest_renewal_orders.id
 * @param {string} reference - payment reference returned by the gateway
 * @returns {Promise<{ status: 'payment_success'|'payment_failed'|'pending_payment', receiptToken?: string }>}
 */
export async function verifyGuestPayment(orderId, reference) {
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, payment_status, payment_reference, payment_gateway, total_amount, receipt_token, expires_at')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    throw Object.assign(new Error('Guest order not found'), { statusCode: 404 });
  }

  // Already resolved — return cached result
  if (order.payment_status === 'payment_success') {
    return { status: 'payment_success', receiptToken: order.receipt_token };
  }
  if (order.payment_status === 'payment_failed') {
    return { status: 'payment_failed' };
  }

  // Reject expired pending orders
  if (order.expires_at && new Date(order.expires_at) < new Date()) {
    throw Object.assign(new Error('This order has expired'), { statusCode: 410 });
  }

  // Reject mismatched reference (prevents marking another user's order paid)
  if (order.payment_reference && reference && order.payment_reference !== reference) {
    throw Object.assign(new Error('Reference does not match this order'), { statusCode: 400 });
  }

  const ref = reference || order.payment_reference;

  if (order.payment_gateway === PAYMENT_GATEWAY.PAYSTACK) {
    let verifyResult;
    try {
      verifyResult = await paystackVerify(ref);
    } catch (err) {
      logError('[GuestRenewal] Paystack verify call failed', { ref, err: err.message });
      return { status: 'pending_payment' };
    }

    if (verifyResult?.status === 'success') {
      const paid = await markGuestOrderPaid(ref);
      if (paid) {
        return { status: 'payment_success', receiptToken: order.receipt_token };
      }
    } else if (verifyResult?.status === 'failed' || verifyResult?.status === 'abandoned') {
      await markGuestOrderFailed(ref);
      return { status: 'payment_failed' };
    }

    return { status: 'pending_payment' };
  }

  if (order.payment_gateway === PAYMENT_GATEWAY.MONICREDIT) {
    let verifyResult;
    try {
      verifyResult = await monicreditVerify(ref);
    } catch (err) {
      logError('[GuestRenewal] MoniCredit verify call failed', { ref, err: err.message });
      return { status: 'pending_payment' };
    }

    const dataStatus = verifyResult?.data?.status?.toLowerCase() || '';
    if (dataStatus === 'approved' || dataStatus === 'success') {
      const paid = await markGuestOrderPaid(ref);
      if (paid) {
        return { status: 'payment_success', receiptToken: order.receipt_token };
      }
    } else if (dataStatus === 'failed' || dataStatus === 'cancelled') {
      await markGuestOrderFailed(ref);
      return { status: 'payment_failed' };
    }

    return { status: 'pending_payment' };
  }

  return { status: 'pending_payment' };
}

// ─── Receipt resend (“find my receipt” recovery path) ────────────────────────────────

/**
 * Re-sends the payment confirmation email for the most recent paid guest order
 * matching the given email address.
 *
 * Always returns silently — do not reveal whether the email exists in our DB
 * to prevent enumeration.
 *
 * @param {string} email
 */
export async function resendGuestReceipt(email) {
  const supabase = getSupabaseAdmin();

  const { data: order } = await supabase
    .from('guest_renewal_orders')
    .select('id, receipt_token, payment_reference, guest_name, total_amount, selected_items, plate_number')
    .eq('guest_email', email.toLowerCase())
    .eq('payment_status', 'payment_success')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!order) return; // silent — don’t reveal whether the email exists

  try {
    const allItems = await getRenewalItems();
    const itemMap = new Map(allItems.map(i => [i.id, i]));
    const documentNames = (order.selected_items || [])
      .map(id => itemMap.get(id)?.name)
      .filter(Boolean);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const receiptUrl = `${frontendUrl}/guest/renewal/receipt?orderId=${order.id}&token=${order.receipt_token}`;

    await sendGuestPaymentConfirmationEmail({
      to: email,
      guestName: order.guest_name,
      reference: order.payment_reference,
      amount: order.total_amount,
      plateNumber: order.plate_number,
      documentNames,
      receiptUrl
    });

    logInfo('[GuestRenewal] Receipt resent', { orderId: order.id, email });
  } catch (err) {
    logError('[GuestRenewal] resendGuestReceipt email failed', { error: err.message });
  }
}
