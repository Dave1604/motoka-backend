/**
 * WHATSAPP WEBHOOK ROUTE
 *
 * Accepts incoming messages from Twilio WhatsApp.
 * Read/log only — does not modify any data.
 *
 * Mount: POST /api/v1/whatsapp/webhook
 *
 * Security:
 *   All inbound requests from Twilio are validated via twilio.webhook()
 *   unless WHATSAPP_SKIP_WEBHOOK_VALIDATION=true is explicitly set (use
 *   only in local development with ngrok, where the URL changes on restart).
 */

import twilio from 'twilio';
import express from 'express';
import { logInfo } from '../utils/logger.js';

const router = express.Router();

const skipValidation = process.env.WHATSAPP_SKIP_WEBHOOK_VALIDATION === 'true';
const webhookMiddleware = skipValidation ? [] : [twilio.webhook()];

/**
 * POST /api/v1/whatsapp/webhook
 *
 * Receives inbound WhatsApp messages from Twilio.
 * Logs sender and message body; returns a TwiML acknowledgement.
 *
 * Expected Twilio payload fields (among others):
 *   From     - Sender's WhatsApp number, prefixed with "whatsapp:" (e.g. whatsapp:+2348012345678)
 *   Body     - Message text sent by the user
 *   To       - Your WhatsApp Business number
 *   NumMedia - Number of media files attached (0 for text messages)
 */
router.post('/webhook', ...webhookMiddleware, (req, res) => {
  const from     = req.body?.From      || 'unknown';
  const body     = req.body?.Body      || '';
  const to       = req.body?.To        || 'unknown';
  const numMedia = parseInt(req.body?.NumMedia || '0', 10);

  logInfo('[WhatsApp] Inbound message received', {
    from,
    to,
    body,
    hasMedia: numMedia > 0,
  });

  // Return empty TwiML so Twilio does not retry.
  // Add a TwiML <Message> response here to enable auto-replies.
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');
});

export default router;
