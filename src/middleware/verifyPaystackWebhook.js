import { verifyWebhookSignature } from '../services/payment/paystack.service.js';
import { logError } from '../utils/logger.js';

// IMPORTANT: This middleware must be used with express.raw() to preserve the raw body for signature verification
export const verifyPaystackWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      console.warn('[Webhook] Missing Paystack signature header');
      return res.status(401).json({ 
        status: false, 
        message: 'Missing signature header' 
      });
    }
    
    const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!rawBody) {
      console.warn('[Webhook] Missing raw body for signature verification');
      return res.status(400).json({
        status: false,
        message: 'Invalid webhook payload'
      });
    }
    
    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const isValid = verifyWebhookSignature(payload, signature);
    
    if (!isValid) {
      console.warn('[Webhook] Invalid Paystack signature');
      return res.status(401).json({ 
        status: false, 
        message: 'Invalid signature' 
      });
    }
    
    next();
    
  } catch (error) {
    logError('Webhook verification error', error);
    return res.status(500).json({ 
      status: false, 
      message: 'Signature verification failed' 
    });
  }
};
export default verifyPaystackWebhook;
