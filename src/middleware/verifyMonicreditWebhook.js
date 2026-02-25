import crypto from 'crypto';
import { logError, logWarn, logInfo } from '../utils/logger.js';

// Timing-safe comparison prevents attackers from measuring how many bytes match
function timingSafeHexCompare(a, b) {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Set SKIP_WEBHOOK_VERIFY=true in .env for local testing only.
// Never set this in staging or production — it disables all signature checks.
export const verifyMonicreditWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-monicredit-signature'] || req.headers['x-signature'];
    const webhookSecret = process.env.MONICREDIT_WEBHOOK_SECRET;
    const skipVerify = process.env.SKIP_WEBHOOK_VERIFY === 'true';

    logInfo('[Monicredit Webhook] Received', { hasSignature: !!signature, hasSecret: !!webhookSecret });

    if (!webhookSecret) {
      logError('MONICREDIT_WEBHOOK_SECRET not configured');
      if (skipVerify) {
        logWarn('[Monicredit Webhook] SKIP_WEBHOOK_VERIFY=true — bypassing (local only)');
        return next();
      }
      return res.status(500).json({ status: false, message: 'Webhook verification configuration error' });
    }

    if (!signature) {
      logWarn('[Monicredit Webhook] Missing signature header');
      if (skipVerify) {
        logWarn('[Monicredit Webhook] SKIP_WEBHOOK_VERIFY=true — bypassing (local only)');
        return next();
      }
      return res.status(401).json({ status: false, message: 'Missing signature header' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!rawBody) {
      logWarn('[Monicredit Webhook] Missing raw body for signature verification');
      return res.status(400).json({ status: false, message: 'Invalid webhook payload' });
    }

    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;

    const expectedSHA256 = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    const expectedSHA512 = crypto.createHmac('sha512', webhookSecret).update(payload).digest('hex');

    // Strip optional algorithm prefix (sha256= or sha512=)
    const bare = signature.replace(/^sha(256|512)=/i, '');

    const isValid =
      timingSafeHexCompare(bare, expectedSHA256) ||
      timingSafeHexCompare(bare, expectedSHA512);

    if (!isValid) {
      logError('Monicredit webhook — invalid signature', { signatureLength: signature.length });
      if (skipVerify) {
        logWarn('[Monicredit Webhook] SKIP_WEBHOOK_VERIFY=true — bypassing (local only)');
        return next();
      }
      return res.status(401).json({ status: false, message: 'Invalid signature' });
    }

    logInfo('[Monicredit Webhook] Signature verified');
    next();

  } catch (error) {
    logError('Monicredit webhook verification error', { message: error.message });
    const skipVerify = process.env.SKIP_WEBHOOK_VERIFY === 'true';
    if (skipVerify) {
      logWarn('[Monicredit Webhook] SKIP_WEBHOOK_VERIFY=true — bypassing error (local only)');
      return next();
    }
    return res.status(500).json({ status: false, message: 'Signature verification failed' });
  }
};

export default verifyMonicreditWebhook;
