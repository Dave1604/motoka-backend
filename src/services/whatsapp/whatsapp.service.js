/**
 * WHATSAPP SERVICE — DEVELOPMENT / SANDBOX ONLY
 *
 * Sends WhatsApp messages via Twilio Sandbox for development and testing.
 * This module is intentionally isolated from all other notification flows.
 *
 * FEATURE FLAG: All sends are gated behind WHATSAPP_REMINDERS_ENABLED=true.
 * The default is false — this service is a no-op unless explicitly enabled.
 *
 * SANDBOX ASSUMPTIONS (flagged with TODO: production migration):
 *  - Sender number is a Twilio Sandbox number, not a verified WA Business number
 *  - Message templates are freeform (not pre-approved by Meta)
 *  - Recipients must have joined the sandbox by texting "join <keyword>" first
 *
 * DO NOT modify any existing email or notification logic in this file.
 */

import twilio from 'twilio';
import { logInfo, logError } from '../../utils/logger.js';

// ─── Feature flags (read once at module load) ────────────────────────────────
const WHATSAPP_ENABLED = process.env.WHATSAPP_REMINDERS_ENABLED === 'true';
const SANDBOX_MODE     = process.env.WHATSAPP_SANDBOX_MODE !== 'false'; // default true

// ─── Lazy singleton Twilio client ────────────────────────────────────────────
let _client = null;

/**
 * Returns the Twilio client, initialising it on first call.
 * Throws only if credentials are missing — caller must handle.
 * @returns {import('twilio').Twilio}
 */
function getClient() {
  if (_client) return _client;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error(
      '[WhatsApp] TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set to send WhatsApp messages'
    );
  }

  _client = twilio(sid, token);
  return _client;
}

/**
 * Returns the WhatsApp sender number from env.
 * TODO: production migration — replace sandbox sender with live Twilio WhatsApp Business number
 * @returns {string|undefined}
 */
function getFromNumber() {
  return process.env.TWILIO_WHATSAPP_FROM;
}

// ─── Internal send helper ────────────────────────────────────────────────────

/**
 * Sends a single WhatsApp message via Twilio.
 * Prefixes `whatsapp:` to both from/to as required by Twilio's WA API.
 *
 * @param {string} to   - Recipient phone number (E.164 format, e.g. +2348012345678)
 * @param {string} body - Message text
 * @returns {Promise<import('twilio/lib/rest/api/v2010/account/message').MessageInstance>}
 */
async function _send(to, body) {
  const from = getFromNumber();

  if (!from) {
    // Treat missing sender as a misconfiguration — log and bail safely
    logError('[WhatsApp] TWILIO_WHATSAPP_FROM is not set; cannot send message', { to });
    return null;
  }

  const client = getClient();

  // TODO: production migration — `from` must be a verified Twilio WhatsApp Business number,
  // not the sandbox shared number. Update TWILIO_WHATSAPP_FROM in production env.
  const message = await client.messages.create({
    from: `whatsapp:${from}`,
    to:   `whatsapp:${to}`,
    body,
  });

  if (SANDBOX_MODE) {
    // TODO: production migration — remove this verbose log or reduce to debug level
    logInfo('[WhatsApp][SANDBOX] Message dispatched', {
      to,
      sid:    message.sid,
      status: message.status,
    });
  }

  return message;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sends a vehicle document expiry reminder via WhatsApp.
 *
 * Integration point: supabase/functions/expiry-notifications/ (Deno Edge Function)
 * Called alongside the existing Resend email — does NOT replace it.
 *
 * @param {object} params
 * @param {string} params.phone          - Recipient phone (E.164)
 * @param {string} params.name           - User's first name
 * @param {string} params.registrationNo - Vehicle registration number
 * @param {string} params.expiryDate     - Formatted expiry date string
 * @param {number} params.daysRemaining  - Days until expiry
 * @param {string} params.renewalUrl     - Direct link to renewal page
 */
export async function sendExpiryReminderWhatsApp({
  phone,
  name,
  registrationNo,
  expiryDate,
  daysRemaining,
  renewalUrl,
}) {
  if (!WHATSAPP_ENABLED) return;

  // TODO: implement opt-in field check — only send to users with `whatsapp_opt_in = true`
  // once the `profiles` table has that column. Currently sending to all users with a phone number.

  if (!phone) {
    logInfo('[WhatsApp] Skipping expiry reminder — user has no phone number', { registrationNo });
    return;
  }

  try {
    const body =
      `Motoka Reminder 🚗 Hi ${name}, your vehicle licence for ${registrationNo} ` +
      `expires in ${daysRemaining} days (${expiryDate}). Renew here: ${renewalUrl}`;

    await _send(phone, body);
    logInfo('[WhatsApp] Expiry reminder sent', { phone, registrationNo, daysRemaining });
  } catch (error) {
    // Never propagate — WhatsApp failure must never break the email/cron flow
    logError('[WhatsApp] Failed to send expiry reminder', {
      error:         error.message,
      phone,
      registrationNo,
    });
  }
}

/**
 * Sends an order status update via WhatsApp.
 *
 * Integration point: src/controllers/admin.controller.js → updateOrderStatus handler
 * Called fire-and-forget alongside the existing email and in-app notification.
 *
 * @param {object} params
 * @param {string} params.phone   - Recipient phone (E.164)
 * @param {string} params.name    - User's first name
 * @param {string} params.orderId - Order number (e.g. "ORD-ABC123")
 * @param {string} params.status  - Human-readable status ("completed" | "cancelled" | etc.)
 */
export async function sendOrderUpdateWhatsApp({ phone, name, orderId, status }) {
  if (!WHATSAPP_ENABLED) return;

  // TODO: implement opt-in field check — check `whatsapp_opt_in` on profiles table

  if (!phone) {
    logInfo('[WhatsApp] Skipping order update — user has no phone number', { orderId });
    return;
  }

  try {
    const body = `Motoka Update 🚗 Hi ${name}, your order #${orderId} status is: ${status}.`;

    await _send(phone, body);
    logInfo('[WhatsApp] Order update sent', { phone, orderId, status });
  } catch (error) {
    logError('[WhatsApp] Failed to send order update', {
      error:   error.message,
      phone,
      orderId,
    });
  }
}

/**
 * Sends a document-ready notification via WhatsApp.
 *
 * Integration point: src/controllers/admin.controller.js → approveDocument handler
 * Called fire-and-forget alongside any existing in-app notification.
 *
 * @param {object} params
 * @param {string} params.phone        - Recipient phone (E.164)
 * @param {string} params.name         - User's first name
 * @param {string} params.vehicleName  - Human-readable vehicle label (e.g. "Toyota Camry")
 * @param {string} params.documentUrl  - Direct URL to the approved document
 */
export async function sendDocumentReadyWhatsApp({ phone, name, vehicleName, documentUrl }) {
  if (!WHATSAPP_ENABLED) return;

  // TODO: implement opt-in field check — check `whatsapp_opt_in` on profiles table

  if (!phone) {
    logInfo('[WhatsApp] Skipping document ready — user has no phone number', { vehicleName });
    return;
  }

  try {
    const body =
      `Motoka Update 🚗 Hi ${name}, your documents for ${vehicleName} are ready. ` +
      `Download here: ${documentUrl}`;

    await _send(phone, body);
    logInfo('[WhatsApp] Document ready notification sent', { phone, vehicleName });
  } catch (error) {
    logError('[WhatsApp] Failed to send document ready notification', {
      error:       error.message,
      phone,
      vehicleName,
    });
  }
}
