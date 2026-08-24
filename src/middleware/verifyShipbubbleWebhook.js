import { logError, logWarn, logInfo } from '../utils/logger.js';
import { verifyShipbubbleWebhookSignature } from '../services/courier/shipbubble.service.js';

/**
 * Verify Shipbubble webhook HMAC-SHA512 (header: x-ship-signature).
 * Must run after express.raw() so req.body is the raw Buffer.
 */
export const verifyShipbubbleWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-ship-signature'] || req.headers['x-shipbubble-signature'];
    const skipVerify = process.env.SKIP_WEBHOOK_VERIFY === 'true';
    const secret = process.env.SHIPBUBBLE_WEBHOOK_SECRET || process.env.SHIPBUBBLE_API_KEY;

    logInfo('[Shipbubble Webhook] Received', { hasSignature: !!signature, hasSecret: !!secret });

    if (!secret) {
      logError('SHIPBUBBLE_API_KEY / SHIPBUBBLE_WEBHOOK_SECRET not configured');
      if (skipVerify) return next();
      return res.status(500).json({ status: false, message: 'Webhook verification configuration error' });
    }

    if (!signature) {
      logWarn('[Shipbubble Webhook] Missing x-ship-signature header');
      if (skipVerify) return next();
      return res.status(401).json({ status: false, message: 'Missing signature header' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!rawBody) {
      return res.status(400).json({ status: false, message: 'Invalid webhook payload' });
    }

    const valid = verifyShipbubbleWebhookSignature(rawBody, signature);
    if (!valid) {
      logError('[Shipbubble Webhook] Invalid signature');
      if (skipVerify) return next();
      return res.status(401).json({ status: false, message: 'Invalid signature' });
    }

    logInfo('[Shipbubble Webhook] Signature verified');
    next();
  } catch (error) {
    logError('[Shipbubble Webhook] Verification error', { message: error.message });
    if (process.env.SKIP_WEBHOOK_VERIFY === 'true') return next();
    return res.status(500).json({ status: false, message: 'Signature verification failed' });
  }
};

export default verifyShipbubbleWebhook;
