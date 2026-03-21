/**
 * WHATSAPP SERVICE — Production (Meta-approved Content Templates)
 *
 * All messages are sent via Twilio's Content Template API using pre-approved
 * templates rather than freeform text. This works for both sandbox and
 * production WhatsApp Business numbers.
 *
 * Template SIDs are read from env vars (TWILIO_TEMPLATE_*) so they can be
 * updated without a code deploy.
 *
 * FEATURE FLAG: All sends are gated behind WHATSAPP_REMINDERS_ENABLED=true.
 * Omitting that env var is a safe default — this service is a no-op unless
 * explicitly enabled.
 */

import twilio from 'twilio';
import { logInfo, logError } from '../../utils/logger.js';

// ─── Lazy singleton Twilio client ─────────────────────────────────────────────
// Initialised on first send so TWILIO_* vars don't need to be set at startup
// if WhatsApp is disabled.
let _client = null;

function getClient() {
  if (_client) return _client;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error(
      '[WhatsApp] TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set'
    );
  }

  _client = twilio(sid, token);
  return _client;
}

// ─── Phone number helpers ──────────────────────────────────────────────────────

/**
 * Normalises any common Nigerian phone format to E.164 (+country + digits).
 *
 *   "08012345678"    → "+2348012345678"
 *   "2348012345678"  → "+2348012345678"
 *   "+2348012345678" → "+2348012345678"
 *
 * Returns null for empty / clearly invalid input.
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.startsWith('whatsapp:') ? raw.slice('whatsapp:'.length) : raw;
  let digits  = cleaned.replace(/[\s\-().]/g, '');

  if (digits.startsWith('+')) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('0')   && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.startsWith('234') && digits.length === 13) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`;

  return null;
}

function toWhatsAppUri(e164) {
  return `whatsapp:${e164}`;
}

// ─── Core send helper ──────────────────────────────────────────────────────────

/**
 * Sends a single WhatsApp message using a pre-approved Twilio Content Template.
 *
 * @param {string} rawTo       - Recipient phone (any common Nigerian format)
 * @param {string} contentSid  - Twilio Content Template SID (HXxxx…)
 * @param {Object} variables   - Template variable values keyed by position string
 *                               e.g. { '1': 'John', '2': 'ABC-123' }
 * @returns {Promise<MessageInstance|null>}
 */
async function _sendTemplate(rawTo, contentSid, variables) {
  const rawFrom = process.env.TWILIO_WHATSAPP_FROM;

  if (!rawFrom) {
    logError('[WhatsApp] TWILIO_WHATSAPP_FROM is not set');
    return null;
  }
  if (!contentSid) {
    logError('[WhatsApp] contentSid is required');
    return null;
  }

  const fromE164 = normalizePhone(rawFrom);
  const toE164   = normalizePhone(rawTo);

  if (!fromE164) {
    logError('[WhatsApp] TWILIO_WHATSAPP_FROM is not a valid phone number', { rawFrom });
    return null;
  }
  if (!toE164) {
    logError('[WhatsApp] Recipient phone is not valid — skipping', { rawTo });
    return null;
  }

  const from = toWhatsAppUri(fromE164);
  const to   = toWhatsAppUri(toE164);

  const client = getClient();

  const message = await client.messages.create({
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify(variables),
  });

  logInfo('[WhatsApp] Template message sent', {
    to:         toE164,
    sid:        message.sid,
    status:     message.status,
    contentSid,
  });

  return message;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends a vehicle document expiry reminder via WhatsApp.
 *
 * Template: motoka_expiry_reminder (HXa64931d606dd7d4f7c2b49b1d33864a9)
 * Body: "Motoka Reminder 🚗 Hi {{1}}, your vehicle licence for {{2}} expires in
 *        {{3}} days ({{4}}). Renew here: {{5}} — Motoka"
 *
 * Integration: supabase/functions/expiry-notifications/ (Deno Edge Function)
 *
 * @param {object} params
 * @param {string} params.phone          - Recipient phone
 * @param {string} params.name           - User's first name
 * @param {string} params.registrationNo - Vehicle plate / reg number
 * @param {string} params.expiryDate     - Formatted date string (YYYY-MM-DD)
 * @param {number} params.daysRemaining  - Days until expiry
 * @param {string} params.renewalUrl     - Direct link to the renewal page
 */
export async function sendExpiryReminderWhatsApp({
  phone,
  name,
  registrationNo,
  expiryDate,
  daysRemaining,
  renewalUrl,
}) {
  if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') return;
  if (!phone) {
    logInfo('[WhatsApp] Skipping expiry reminder — no phone number', { registrationNo });
    return;
  }

  const contentSid = process.env.TWILIO_TEMPLATE_EXPIRY_REMINDER;
  if (!contentSid) {
    logError('[WhatsApp] TWILIO_TEMPLATE_EXPIRY_REMINDER is not set');
    return;
  }

  try {
    await _sendTemplate(phone, contentSid, {
      '1': String(name),
      '2': String(registrationNo),
      '3': String(daysRemaining),
      '4': String(expiryDate),
      '5': String(renewalUrl),
    });
    logInfo('[WhatsApp] Expiry reminder sent', { phone, registrationNo, daysRemaining });
  } catch (error) {
    // Never propagate — WhatsApp failure must never break the email/cron flow
    logError('[WhatsApp] Failed to send expiry reminder', {
      error: error.message,
      phone,
      registrationNo,
    });
  }
}

/**
 * Sends an order status update via WhatsApp.
 *
 * Template: motoka_order_update (HX9ad81618bef89cf4b1f4a89428e42611)
 * Body: "Motoka Update 🚗 Hi {{1}}, your order #{{2}} has been updated to: {{3}}.
 *        Thank you for choosing Motoka."
 *
 * Integration: src/controllers/admin.controller.js → updateOrderStatus
 *
 * @param {object} params
 * @param {string} params.phone   - Recipient phone
 * @param {string} params.name    - User's first name
 * @param {string} params.orderId - Order number (e.g. "ORD-ABC123")
 * @param {string} params.status  - Human-readable status ("completed" | "cancelled" | etc.)
 */
export async function sendOrderUpdateWhatsApp({ phone, name, orderId, status }) {
  if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') return;
  if (!phone) {
    logInfo('[WhatsApp] Skipping order update — no phone number', { orderId });
    return;
  }

  const contentSid = process.env.TWILIO_TEMPLATE_ORDER_UPDATE;
  if (!contentSid) {
    logError('[WhatsApp] TWILIO_TEMPLATE_ORDER_UPDATE is not set');
    return;
  }

  try {
    await _sendTemplate(phone, contentSid, {
      '1': String(name),
      '2': String(orderId),
      '3': String(status),
    });
    logInfo('[WhatsApp] Order update sent', { phone, orderId, status });
  } catch (error) {
    logError('[WhatsApp] Failed to send order update', {
      error: error.message,
      phone,
      orderId,
    });
  }
}

/**
 * Sends a document-ready notification via WhatsApp.
 *
 * Template: motoka_document_ready (HX1c2a4ff508a6aa45a71b026372439889)
 * Body: "Motoka Update 🚗 Hi {{1}}, your documents for {{2}} are ready.
 *        Download here: {{3}} — Motoka"
 *
 * Integration: src/controllers/admin.controller.js → approveDocument
 *
 * @param {object} params
 * @param {string} params.phone        - Recipient phone
 * @param {string} params.name         - User's first name
 * @param {string} params.vehicleName  - e.g. "Toyota Camry"
 * @param {string} params.documentUrl  - Direct URL to the approved document
 */
export async function sendDocumentReadyWhatsApp({ phone, name, vehicleName, documentUrl }) {
  if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') return;
  if (!phone) {
    logInfo('[WhatsApp] Skipping document ready — no phone number', { vehicleName });
    return;
  }

  const contentSid = process.env.TWILIO_TEMPLATE_DOCUMENT_READY;
  if (!contentSid) {
    logError('[WhatsApp] TWILIO_TEMPLATE_DOCUMENT_READY is not set');
    return;
  }

  try {
    await _sendTemplate(phone, contentSid, {
      '1': String(name),
      '2': String(vehicleName),
      '3': String(documentUrl),
    });
    logInfo('[WhatsApp] Document ready notification sent', { phone, vehicleName });
  } catch (error) {
    logError('[WhatsApp] Failed to send document ready notification', {
      error: error.message,
      phone,
      vehicleName,
    });
  }
}

/**
 * Sends an "add your car" prompt via WhatsApp to users without any registered vehicles.
 *
 * Template: motoka_add_car_reminder (HX7dd524df72e89295bc5cbcd8f6338f49)
 * Body: "Motoka 🚗 Hi {{1}}, you haven't added a vehicle to your Motoka account yet.
 *        Add your car today to track renewals and never miss an expiry date.
 *        Get started here: {{2}} — Motoka"
 *
 * Integration: src/controllers/admin.controller.js → broadcastAddCarReminder
 *
 * @param {object} params
 * @param {string} params.phone   - Recipient phone
 * @param {string} params.name    - User's first name
 * @param {string} params.appUrl  - Dashboard / car registration URL
 */
export async function sendAddCarReminderWhatsApp({ phone, name, appUrl }) {
  if (process.env.WHATSAPP_REMINDERS_ENABLED !== 'true') return;
  if (!phone) return;

  const contentSid = process.env.TWILIO_TEMPLATE_ADD_CAR_REMINDER;
  if (!contentSid) {
    logError('[WhatsApp] TWILIO_TEMPLATE_ADD_CAR_REMINDER is not set');
    return;
  }

  try {
    await _sendTemplate(phone, contentSid, {
      '1': String(name),
      '2': String(appUrl),
    });
    logInfo('[WhatsApp] Add-car reminder sent', { phone });
  } catch (error) {
    logError('[WhatsApp] Failed to send add-car reminder', {
      error: error.message,
      phone,
    });
  }
}
