import crypto from 'crypto';
import { logError } from '../utils/logger.js';

/**
 * Timing-safe hex string comparison to prevent timing attacks
 * @param {string} a - First hex string
 * @param {string} b - Second hex string
 * @returns {boolean} - True if strings are equal
 */
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

export const verifyMonicreditWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-monicredit-signature'] || req.headers['x-signature'];
    const webhookSecret = process.env.MONICREDIT_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';
    
    console.log('[Monicredit Webhook] Received webhook:', {
      signature: signature ? 'present' : 'missing',
      hasSecret: !!webhookSecret,
      environment: process.env.NODE_ENV || 'development',
      contentType: req.headers['content-type']
    });
    
    if (!webhookSecret) {
      const errorMessage = 'MONICREDIT_WEBHOOK_SECRET not configured';
      console.error('[Monicredit Webhook]', errorMessage);
      
      if (isProduction) {
        logError('Monicredit webhook verification failed - missing secret', {
          message: errorMessage,
          environment: 'production'
        });
        return res.status(500).json({
          status: false,
          message: 'Webhook verification configuration error'
        });
      }
      
      // In development, warn but allow through for testing
      console.warn('[Monicredit Webhook]', errorMessage, '- allowing through in development mode');
      return next();
    }
    
    if (!signature) {
      const errorMessage = 'Missing signature header';
      console.warn('[Monicredit Webhook]', errorMessage);
      
      if (isProduction) {
        logError('Monicredit webhook verification failed - missing signature', {
          message: errorMessage,
          headers: Object.keys(req.headers)
        });
        return res.status(401).json({
          status: false,
          message: 'Missing signature header'
        });
      }
      
      // In development, warn but allow through for testing
      console.warn('[Monicredit Webhook]', errorMessage, '- allowing through in development mode');
      return next();
    }
    
    const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!rawBody) {
      console.warn('[Monicredit Webhook] Missing raw body for signature verification');
      return res.status(400).json({
        status: false,
        message: 'Invalid webhook payload'
      });
    }
    
    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');
    
    const expectedSignatureSHA512 = crypto
      .createHmac('sha512', webhookSecret)
      .update(payload)
      .digest('hex');
    
    // Strip prefix if present (sha256= or sha512=)
    const bare = signature.startsWith('sha256=') ? signature.slice(7)
               : signature.startsWith('sha512=') ? signature.slice(7)
               : signature;
    
    // Use timing-safe comparison to prevent timing attacks
    const isValid =
      timingSafeHexCompare(bare, expectedSignature) ||
      timingSafeHexCompare(bare, expectedSignatureSHA512);
    
    if (!isValid) {
      const logData = {
        receivedPrefix: signature.substring(0, 20) + '...',
        expectedSHA256Prefix: expectedSignature.substring(0, 20) + '...',
        expectedSHA512Prefix: expectedSignatureSHA512.substring(0, 20) + '...',
        signatureLength: signature.length,
        environment: process.env.NODE_ENV || 'development'
      };
      
      console.warn('[Monicredit Webhook] Invalid signature detected:', logData);
      
      if (isProduction) {
        logError('Monicredit webhook verification failed - invalid signature', logData);
        return res.status(401).json({
          status: false,
          message: 'Invalid signature'
        });
      }
      
      console.warn('[Monicredit Webhook] Invalid signature - allowing through in development mode');
      return next();
    }
    
    console.log('[Monicredit Webhook] Signature verified successfully');
    next();
    
  } catch (error) {
    logError('Monicredit webhook verification error', error);
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      return res.status(500).json({
        status: false,
        message: 'Signature verification failed'
      });
    }
    
    console.warn('[Monicredit Webhook] Verification error - allowing through in development mode:', error.message);
    next();
  }
};

export default verifyMonicreditWebhook;
