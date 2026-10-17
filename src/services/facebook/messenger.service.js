/**
 * FACEBOOK MESSENGER SERVICE
 *
 * Sends replies through the Graph API and verifies webhook requests from
 * Meta. One send path serves both Messenger and Instagram — the recipient
 * id (psid / igsid) is the only difference, and Meta accepts either as
 * `recipient.id`.
 *
 * All Graph calls are fire-and-forget from the caller's perspective: a
 * failure logs and returns null rather than throwing, so one undeliverable
 * message never rolls back conversation state that has already been written.
 */

import crypto from 'crypto';
import { logError, logInfo, logWarn } from '../../utils/logger.js';

const GRAPH_VERSION = 'v18.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Lazy so the module can be imported before env is validated.
let _pageToken = null;
function getPageToken() {
  if (_pageToken) return _pageToken;
  _pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!_pageToken) {
    throw new Error('[Facebook] FACEBOOK_PAGE_ACCESS_TOKEN is not set');
  }
  return _pageToken;
}

/**
 * Webhook verification handshake (GET).
 *
 * Meta sends hub.mode / hub.verify_token / hub.challenge. We echo the
 * challenge back only when the verify token matches what we chose at
 * setup time. Returns the challenge string to send, or null to reject.
 */
export function verifyWebhook({ mode, verifyToken, challenge }) {
  const expected = process.env.FACEBOOK_VERIFY_TOKEN;
  if (!expected) {
    logWarn('[Facebook] FACEBOOK_VERIFY_TOKEN is not set — rejecting verification');
    return null;
  }
  if (mode !== 'subscribe' || verifyToken !== expected) {
    logWarn('[Facebook] Webhook verification failed', { mode, verifyToken });
    return null;
  }
  return challenge;
}

/**
 * Signature check for inbound POSTs (X-Hub-Signature-256).
 *
 * Meta signs the raw body with the app secret. We verify against the exact
 * bytes that arrived — which is why the route is mounted behind
 * express.raw(), not express.json().
 *
 * Returns true when valid, or when no app secret is configured (local
 * development only — the caller logs a warning in that case).
 */
export function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!secret) {
    logWarn('[Facebook] FACEBOOK_APP_SECRET not set — skipping signature verification');
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Send a plain-text message to a psid / igsid.
 *
 * Returns true on delivery-accepted, false otherwise. Never throws.
 */
export async function sendTextMessage(recipientId, text) {
  if (!recipientId || !text) return false;

  try {
    const token = getPageToken();
    const res = await fetch(`${GRAPH_BASE}/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        // Without messaging_type Meta rejects the send. PERSONAL_RESPONSE
        // is the tag for replying inside a 24-hour customer-service window,
        // which is exactly what an inbound webhook reply is.
        messaging_type: 'PERSONAL_RESPONSE',
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      logError('[Facebook] Send failed', {
        recipientId,
        status: res.status,
        error: data.error?.message || 'unknown',
      });
      return false;
    }

    logInfo('[Facebook] Message sent', { recipientId, messageId: data.message_id });
    return true;
  } catch (err) {
    logError('[Facebook] Send threw', { recipientId, error: err.message });
    return false;
  }
}
