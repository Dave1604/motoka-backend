/**
 * WHATSAPP WEBHOOK ROUTE — DEVELOPMENT / SANDBOX ONLY
 *
 * Accepts incoming messages from the Twilio Sandbox.
 * Used for testing two-way messaging locally.
 *
 * This route has zero impact on production business logic.
 * It does NOT modify any data — read/log only.
 *
 * Mount: POST /api/v1/whatsapp/webhook
 *
 * Twilio will POST to this URL whenever a sandbox user replies to a message.
 * The body is URL-encoded (application/x-www-form-urlencoded) per Twilio spec.
 *
 * TODO: production migration — if two-way messaging is required in production,
 * add Twilio request signature validation using `twilio.webhook()` middleware
 * and the production auth token.
 */

import express from 'express';
import { logInfo } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/v1/whatsapp/webhook
 *
 * Receives inbound WhatsApp messages from Twilio Sandbox.
 * Logs sender and message body; returns a safe TwiML acknowledgement.
 *
 * Expected Twilio payload fields (among others):
 *   From    - Sender's WhatsApp number, prefixed with "whatsapp:" (e.g. whatsapp:+2348012345678)
 *   Body    - Message text sent by the user
 *   To      - Your sandbox number
 *   NumMedia - Number of media files attached (0 for text messages)
 */
router.post('/webhook', (req, res) => {
  // Twilio sends URL-encoded bodies; express.urlencoded() (already mounted in index.js) parses this
  const from    = req.body?.From   || 'unknown';
  const body    = req.body?.Body   || '';
  const to      = req.body?.To     || 'unknown';
  const numMedia = parseInt(req.body?.NumMedia || '0', 10);

  logInfo('[WhatsApp][SANDBOX] Inbound message received', {
    from,
    to,
    body,
    hasMedia: numMedia > 0,
  });

  // Return empty TwiML so Twilio does not retry — no auto-reply for sandbox testing
  // TODO: production migration — add TwiML <Message> response here if you want auto-replies
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');
});

export default router;
