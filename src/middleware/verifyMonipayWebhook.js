import { logError, logWarn, logInfo } from '../utils/logger.js';
import { verifyWebhookSignature } from '../services/payment/monipay/monipay.service.js';

export const verifyMonipayWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-monipay-signature'] || req.headers['x-signature'];
    const skipVerify = process.env.SKIP_WEBHOOK_VERIFY === 'true';
    const secret = process.env.MONIPAY_WEBHOOK_SECRET || process.env.MONIPAY_SECRET_KEY;

    logInfo('[Monipay Webhook] Received', { hasSignature: !!signature, hasSecret: !!secret });

    if (!secret) {
      logError('MONIPAY_SECRET_KEY / MONIPAY_WEBHOOK_SECRET not configured');
      if (skipVerify) return next();
      return res.status(500).json({ status: false, message: 'Webhook verification configuration error' });
    }

    if (!signature) {
      logWarn('[Monipay Webhook] Missing signature header');
      if (skipVerify) return next();
      return res.status(401).json({ status: false, message: 'Missing signature header' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!rawBody) {
      return res.status(400).json({ status: false, message: 'Invalid webhook payload' });
    }

    const valid = verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      logError('[Monipay Webhook] Invalid signature');
      if (skipVerify) return next();
      return res.status(401).json({ status: false, message: 'Invalid signature' });
    }

    logInfo('[Monipay Webhook] Signature verified');
    next();
  } catch (error) {
    logError('[Monipay Webhook] Verification error', { message: error.message });
    if (process.env.SKIP_WEBHOOK_VERIFY === 'true') return next();
    return res.status(500).json({ status: false, message: 'Signature verification failed' });
  }
};

export default verifyMonipayWebhook;
