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
import { quoteFromDeliveryFields, DeliveryQuoteError } from '../courier/deliveryQuote.service.js';
import { TerminalError } from '../courier/terminal.service.js';
import { generatePaymentReference, sanitizeAttribution } from '../../utils/paymentHelpers.js';
import { verifyTransaction as monicreditVerify } from '../payment/monicredit/monicredit.service.js';
import { initializeTransaction as paystackInit, verifyTransaction as paystackVerify } from '../payment/paystack.service.js';
import { initializeTransaction as monipayInit, verifyTransaction as monipayVerify } from '../payment/monipay/monipay.service.js';
import { PAYMENT_GATEWAY } from '../../constants/payment.constants.js';
import { sendGuestPaymentConfirmationEmail } from '../email/paymentEmail.service.js';
import { sendAdminGuestOrderAlert } from '../email/adminOrderAlert.service.js';
import { computeSchedule } from '../payment/scheduling.util.js';

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
 * @param {string} params.paymentGateway  - "monipay" | "paystack"
 * @param {string} params.frontendBaseUrl - Used to build callback URL
 * @param {Object} [params.attribution] - Marketing attribution { source, campaign }
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
  paymentGateway = PAYMENT_GATEWAY.MONIPAY,
  frontendBaseUrl,
  renewalState = null,
  attribution = null
}) {
  if (paymentGateway === PAYMENT_GATEWAY.MONICREDIT) {
    paymentGateway = PAYMENT_GATEWAY.MONIPAY;
  }
  if (paymentGateway !== PAYMENT_GATEWAY.PAYSTACK) {
    paymentGateway = PAYMENT_GATEWAY.MONIPAY;
  }

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
    let quote;
    try {
      quote = await quoteFromDeliveryFields(deliveryDetails, {
        purpose: 'renewal',
        selectedItems,
      });
    } catch (quoteError) {
      if (quoteError instanceof DeliveryQuoteError || quoteError instanceof TerminalError) {
        throw Object.assign(new Error(quoteError.message), { statusCode: quoteError.statusCode || 400 });
      }
      throw quoteError;
    }
    deliveryFee = quote.fee_kobo;
    resolvedDelivery = {
      address: quote.address,
      state: quote.stateCode,
      lga: quote.lgaName,
      contact: quote.contact,
      fee: deliveryFee,
      estimated_weight_kg: quote.weight_kg,
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
  const cleanAttribution = sanitizeAttribution(attribution);

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
      renewal_state: renewalState || null,
      payment_gateway: paymentGateway,
      payment_reference: paymentReference,
      attribution_source: cleanAttribution?.source || null,
      attribution_campaign: cleanAttribution?.campaign || null,
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

  const callbackUrl = `${frontendBaseUrl}/guest/renewal/callback?orderId=${order.id}&gateway=${paymentGateway}`;

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
      deliveryDetails: resolvedDelivery,
      attribution: cleanAttribution
    });
  } else {
    gatewayResult = await _initMonipay({
      email,
      amount: totalAmount,
      reference: paymentReference,
      callbackUrl,
      name,
      phone,
      firstName,
      lastName,
      plateNumber,
      selectedItems,
      deliveryDetails: resolvedDelivery
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

async function _initPaystack({ email, amount, reference, callbackUrl, name, plateNumber, selectedItems, deliveryDetails, attribution = null }) {
  const metadata = {
    is_guest: true,
    guest_name: name,
    guest_plate: plateNumber,
    selected_items: selectedItems,
    delivery_details: deliveryDetails,
    ...(attribution ? { attribution } : {}),
    custom_fields: [
      { display_name: 'Plate Number', variable_name: 'plate_number', value: plateNumber },
      { display_name: 'Customer', variable_name: 'customer', value: name },
      ...(attribution?.source ? [{ display_name: 'Source', variable_name: 'attribution_source', value: attribution.source }] : []),
      ...(attribution?.campaign ? [{ display_name: 'Campaign', variable_name: 'attribution_campaign', value: attribution.campaign }] : [])
    ]
  };

  return paystackInit({ email, amount, reference, callback_url: callbackUrl, metadata });
}

async function _initMonipay({ email, amount, reference, callbackUrl, name, phone, firstName, lastName, plateNumber, selectedItems, deliveryDetails }) {
  return monipayInit({
    email,
    amount,
    reference,
    callback_url: callbackUrl,
    first_name: firstName,
    last_name: lastName,
    phone,
    metadata: {
      is_guest: true,
      guest_name: name,
      guest_plate: plateNumber,
      selected_items: selectedItems,
      delivery_details: deliveryDetails,
    },
  });
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
 * Creates a passwordless account for a guest payer (no existing profile) and
 * links the paid order to it. The guest claims it with OTP login
 * (shouldCreateUser:false accepts pre-existing users) or by setting a
 * password on the receipt page. Never throws — returns the new user id or
 * null. Never reassigns cars: no cars row is created here at all; the order
 * link alone is what surfaces the renewal in the new account's history.
 */
export async function autoCreateGuestAccount(supabase, order) {
  try {
    const email = order.guest_email.toLowerCase();
    const nameParts = (order.guest_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Guest';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone: order.guest_phone || '',
        auto_created: true,
        guest_order_id: order.id,
      },
    });

    if (authError) {
      // Lost a race with a real signup between the profile check and now:
      // link to the winner instead of failing.
      if (authError.message?.toLowerCase().includes('already been registered')) {
        const { data: winner } = await supabase
          .from('profiles').select('id').eq('email', email).maybeSingle();
        if (winner?.id) {
          await supabase
            .from('guest_renewal_orders')
            .update({ linked_user_id: winner.id, updated_at: new Date().toISOString() })
            .eq('id', order.id);
          logInfo('[GuestRenewal] Auto-create raced a signup — linked to winner', { orderId: order.id, userId: winner.id });
          return winner.id;
        }
      }
      logError('[GuestRenewal] Auto-create auth user failed (non-fatal)', { error: authError.message, orderId: order.id });
      return null;
    }

    const userId = authData.user.id;

    let shortUserId;
    for (let i = 0; i < 10; i++) {
      const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
      const { data: conflict } = await supabase
        .from('profiles').select('id').eq('user_id', candidate).maybeSingle();
      if (!conflict) { shortUserId = candidate; break; }
    }
    if (!shortUserId) {
      logError('[GuestRenewal] Auto-create short id exhausted (non-fatal)', { orderId: order.id });
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      return null;
    }

    // Phone is globally unique on profiles — a collision (shared family
    // number, recycled line) must not sink the account; store without it.
    let profileError = (
      await supabase.from('profiles').insert({
        id: userId,
        user_id: shortUserId,
        first_name: firstName,
        last_name: lastName,
        phone_number: order.guest_phone || null,
        email,
        user_type_id: 2,
      })
    ).error;
    if (profileError && /unique|duplicate|already exists/i.test(profileError.message || '')) {
      profileError = (
        await supabase.from('profiles').insert({
          id: userId,
          user_id: shortUserId,
          first_name: firstName,
          last_name: lastName,
          phone_number: null,
          email,
          user_type_id: 2,
        })
      ).error;
    }
    if (profileError) {
      logError('[GuestRenewal] Auto-create profile failed (non-fatal)', { error: profileError.message, orderId: order.id });
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      return null;
    }

    await supabase
      .from('guest_renewal_orders')
      .update({ linked_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    logInfo('[GuestRenewal] Account auto-created and order linked', { orderId: order.id, userId });
    return userId;
  } catch (err) {
    logError('[GuestRenewal] Auto-create failed (non-fatal)', { error: err.message, orderId: order?.id });
    return null;
  }
}

/**
 * Called from the webhook handler when payment for a guest reference succeeds.
 * Marks the guest_renewal_order as payment_success.
 */
/**
 * @param {string} paymentReference
 * @param {Object} [options]
 * @param {Function} [options.verifyWithGateway] - Async callback returning the
 *   gateway's verify result. When supplied, the order is only marked paid if the
 *   gateway independently confirms success and the reported amount matches the
 *   order total. Webhook callers must pass this: a webhook body is an assertion
 *   by the sender, not proof of payment. Callers that have already verified may
 *   omit it.
 */
export async function markGuestOrderPaid(paymentReference, { verifyWithGateway } = {}) {
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from('guest_renewal_orders')
    .select('id, payment_status, guest_email, guest_name, guest_phone, plate_number, total_amount, delivery_fee, selected_items, receipt_token, expiry_date')
    .eq('payment_reference', paymentReference)
    .maybeSingle();

  if (error || !order) {
    logError('[GuestRenewal] markGuestOrderPaid: order not found', { paymentReference });
    return null;
  }

  if (typeof verifyWithGateway === 'function') {
    let verified;
    try {
      verified = await verifyWithGateway();
    } catch (verifyError) {
      logError('[GuestRenewal] markGuestOrderPaid: gateway verify threw — not fulfilling', {
        paymentReference,
        orderId: order.id,
        error: verifyError.message,
      });
      return null;
    }

    if (!verified?.success && verified?.status !== 'success') {
      logError('[GuestRenewal] markGuestOrderPaid: gateway did not confirm success', {
        paymentReference,
        orderId: order.id,
        status: verified?.status,
      });
      return null;
    }

    if (typeof verified.amount !== 'number') {
      logError('[GuestRenewal] markGuestOrderPaid: gateway reported no amount — not fulfilling', {
        paymentReference,
        orderId: order.id,
      });
      return null;
    }

    if (Math.abs(verified.amount - Number(order.total_amount)) > 1) {
      logError('[GuestRenewal] markGuestOrderPaid: amount mismatch — not fulfilling', {
        paymentReference,
        orderId: order.id,
        expected: order.total_amount,
        actual: verified.amount,
      });
      return null;
    }
  }

  if (order.payment_status === 'payment_success') {
    logDebug('[GuestRenewal] Already marked paid, skipping', { orderId: order.id });
    return order;
  }

  // The gateway webhook and the receipt page's verify call race each other on
  // every guest payment. Both read the row above before either has written
  // it, so the check alone let both through: on 2026-10-13 one customer got
  // two receipts and ops two alerts for one order. The UPDATE is the claim —
  // only the caller whose write actually flips the row owns the side effects.
  const { data: claimed, error: updateError } = await supabase
    .from('guest_renewal_orders')
    .update({ payment_status: 'payment_success', updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .neq('payment_status', 'payment_success')
    .select('id')
    .maybeSingle();

  if (updateError) {
    logError('[GuestRenewal] Failed to mark order paid', updateError);
    return null;
  }

  if (!claimed) {
    logDebug('[GuestRenewal] Lost the mark-paid race, skipping side effects', { orderId: order.id });
    return order;
  }

  logInfo('[GuestRenewal] Order marked as payment_success', { orderId: order.id, reference: paymentReference });

  // Auto-link to existing account if the guest email belongs to a registered user.
  // Otherwise auto-create a passwordless account the guest can claim with OTP
  // login or by setting a password on the receipt page. Done silently — a
  // failure here must never block payment confirmation.
  let accountCreated = false;
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
    } else {
      const newUserId = await autoCreateGuestAccount(supabase, order);
      accountCreated = !!newUserId;
    }
  } catch (linkErr) {
    logError('[GuestRenewal] Auto-link check failed (non-fatal)', { error: linkErr.message, orderId: order.id });
  }

  // Scheduled hold: renewals paid more than the window before expiry wait
  // for the window instead of landing on ops' desk months early. Unclaimed
  // orders (no linked account — registration required before processing)
  // are held the same way; the sweeper only releases claimed orders.
  let guestScheduledFor = null;
  try {
    const { scheduledFor } = computeSchedule({ expiryDate: order.expiry_date });
    if (scheduledFor) {
      const { error: schedErr } = await supabase
        .from('guest_renewal_orders')
        .update({ scheduled_for: scheduledFor, updated_at: new Date().toISOString() })
        .eq('id', order.id);
      if (schedErr) throw schedErr;
      guestScheduledFor = scheduledFor;
      logInfo('[GuestRenewal] Order held as scheduled', { orderId: order.id, scheduledFor });
    }
  } catch (schedErr) {
    logError('[GuestRenewal] Schedule hold failed (non-fatal) — order stays actionable', { error: schedErr.message, orderId: order.id });
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
      receiptUrl,
      accountCreated,
      scheduledFor: guestScheduledFor
    });
  } catch (emailErr) {
    logError('[GuestRenewal] Failed to send confirmation email', { error: emailErr.message, orderId: order.id });
  }

  // Ops alert — kept independent of the customer email above, because a
  // bounced customer address is precisely when ops needs to hear about the
  // order. Reached once per order: only the caller that won the UPDATE above
  // gets here. Scheduled orders are deliberately NOT
  // alerted here — the sweeper alerts when the window opens, so early
  // payments never rot in the inbox for months.
  if (guestScheduledFor) {
    logInfo('[GuestRenewal] Ops alert deferred to window', { orderId: order.id, scheduledFor: guestScheduledFor });
  } else {
  try {
    const allItems = await getRenewalItems();
    const itemMap = new Map(allItems.map(i => [i.id, i]));
    await sendAdminGuestOrderAlert({
      orderId: order.id,
      guestName: order.guest_name,
      guestEmail: order.guest_email,
      guestPhone: order.guest_phone,
      plateNumber: order.plate_number,
      totalAmountKobo: order.total_amount,
      deliveryFeeKobo: order.delivery_fee,
      documentNames: (order.selected_items || []).map(id => itemMap.get(id)?.name).filter(Boolean),
      reference: paymentReference,
    });
  } catch (alertErr) {
    logError('[GuestRenewal] Admin alert failed (non-fatal)', { error: alertErr.message, orderId: order.id });
  }
  }

  return order;
}

/**
 * Called from the webhook handler when payment for a guest reference fails.
 */
export async function markGuestOrderFailed(paymentReference) {
  const supabase = getSupabaseAdmin();

  // Only a pending order can become failed. Without this guard a late or
  // out-of-order charge.failed event could overwrite a success, and a
  // pre-retry failure would keep re-asserting itself.
  await supabase
    .from('guest_renewal_orders')
    .update({ payment_status: 'payment_failed', updated_at: new Date().toISOString() })
    .eq('payment_reference', paymentReference)
    .eq('payment_status', 'pending_payment');
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

  // Success is final — return cached result.
  if (order.payment_status === 'payment_success') {
    return { status: 'payment_success', receiptToken: order.receipt_token };
  }
  // payment_failed is deliberately NOT cached: a declined first attempt marks
  // the order failed within seconds, but the customer can retry inside the
  // same gateway popup under the same reference and succeed. Trusting the
  // cached failure made that success unrecoverable — money taken, order
  // stuck, no receipt (guest order 45bbc471, 2026-09-20). Fall through and
  // ask the gateway again.

  // Reject mismatched reference (prevents marking another user's order paid)
  if (order.payment_reference && reference && order.payment_reference !== reference) {
    throw Object.assign(new Error('Reference does not match this order'), { statusCode: 400 });
  }

  const ref = reference || order.payment_reference;

  if (order.payment_gateway === PAYMENT_GATEWAY.PAYSTACK || order.payment_gateway === PAYMENT_GATEWAY.MONIPAY) {
    let verifyResult;
    try {
      verifyResult = order.payment_gateway === PAYMENT_GATEWAY.MONIPAY
        ? await monipayVerify(ref)
        : await paystackVerify(ref);
    } catch (err) {
      logError('[GuestRenewal] Gateway verify call failed', {
        ref,
        gateway: order.payment_gateway,
        err: err.message,
      });
      return { status: 'pending_payment' };
    }

    if (verifyResult?.status === 'success' || verifyResult?.success === true) {
      const paid = await markGuestOrderPaid(ref);
      if (paid) {
        return { status: 'payment_success', receiptToken: order.receipt_token };
      }
    } else if (verifyResult?.status === 'failed' || verifyResult?.status === 'abandoned') {
      await markGuestOrderFailed(ref);
      return { status: 'payment_failed' };
    }
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
  }

  if (order.expires_at && new Date(order.expires_at) < new Date()) {
    throw Object.assign(new Error('This order has expired'), { statusCode: 410 });
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
