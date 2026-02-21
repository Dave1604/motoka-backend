import express, { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { verifyPaystackWebhook } from '../middleware/verifyPaystackWebhook.js';
import { paymentLimiter } from '../middleware/rateLimiter.js';
import {
  initializePayment,
  verifyPayment,
  getTransaction,
  getTransactionStatus,
  cancelPayment,
  retryPayment,
  getPaymentHistory,
  getCarPayments,
  getCarPaymentReceipt,
  getPaymentConfig,
  getRenewalItems,
  getPaymentHeads,
  getStates,
  getLGAs,
  checkExistingPayments,
  handlePaystackWebhook,
  getUserOrdersHandler,
  getOrder,
  getSubscriptions,
  createSubscriptionHandler,
  cancelSubscriptionHandler,
  pauseSubscriptionHandler,
  resumeSubscriptionHandler
} from '../controllers/payment.controller.js';

const router = Router();

router.get('/payment/callback', async (req, res) => {
  const { reference, trxref, status } = req.query;
  const ref = reference || trxref;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
  
  if (!ref) {
    return res.redirect(`${frontendUrl}/payment/error?message=No payment reference provided`);
  }
  
  const callbackUrl = status 
    ? `${frontendUrl}/payment/paystack/callback?reference=${ref}&status=${status}`
    : `${frontendUrl}/payment/paystack/callback?reference=${ref}`;
  
  return res.redirect(callbackUrl);
});

// SECURITY: express.raw() must be applied BEFORE verifyPaystackWebhook for signature verification
router.post(
  '/webhooks/paystack',
  express.raw({ type: 'application/json', limit: '2mb' }),
  verifyPaystackWebhook,
  (req, res, next) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      req.body = raw ? JSON.parse(raw) : {};
      next();
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: 'Invalid JSON payload'
      });
    }
  },
  handlePaystackWebhook
);

router.get('/payments/config', authenticate, getPaymentConfig);
router.get('/payment-schedule', authenticate, getRenewalItems);
router.get('/payment-schedule/get-payment-head', authenticate, getPaymentHeads);
router.get('/get-all-state', authenticate, getStates);
router.get('/payments/states/:stateCode/lgas', authenticate, getLGAs);
router.get('/get-lga/:stateCode', authenticate, getLGAs);

router.post(
  '/payments/initialize',
  authenticate,
  checkEmailVerified,
  paymentLimiter,
  initializePayment
);

router.get(
  '/payments/verify/:reference',
  authenticate,
  paymentLimiter,
  verifyPayment
);

router.get('/payments/:reference/status', authenticate, getTransactionStatus);
router.put('/payments/:reference/cancel', authenticate, cancelPayment);

router.post(
  '/payments/:reference/retry',
  authenticate,
  checkEmailVerified,
  paymentLimiter,
  retryPayment
);

router.get('/payments/:reference', authenticate, getTransaction);

router.post(
  '/paystack/initialize',
  authenticate,
  checkEmailVerified,
  paymentLimiter,
  initializePayment
);

router.post(
  '/payment/paystack/verify/:reference',
  authenticate,
  paymentLimiter,
  verifyPayment
);

router.post('/payment/check-existing', authenticate, checkExistingPayments);
router.get('/payments/history', authenticate, getPaymentHistory);
router.get('/payments/car/:slug', authenticate, getCarPayments);
router.get('/payment/car-receipt/:identifier', authenticate, getCarPaymentReceipt);

router.get(
  '/payment/debug/:reference',
  authenticate,
  async (req, res) => {
    try {
      const { reference } = req.params;
      const userId = req.user.id;
      
      const { getSupabaseAdmin } = await import('../config/supabase.js');
      const supabaseAdmin = getSupabaseAdmin();
      
      const { data: transactions } = await supabaseAdmin
        .from('payment_transactions')
        .select('*')
        .or(`reference.eq.${reference},paystack_reference.eq.${reference}`)
        .order('created_at', { ascending: false });
      
      const userTransactions = transactions?.filter(tx => tx.user_id === userId) || [];
      
      const transactionIds = userTransactions.map(tx => tx.id);
      const { data: orders } = await supabaseAdmin
        .from('renewal_orders')
        .select('*')
        .in('transaction_id', transactionIds);
      
      res.json({
        status: true,
        data: {
          reference,
          userId,
          transactions: userTransactions.map(tx => ({
            id: tx.id,
            reference: tx.reference,
            paystack_reference: tx.paystack_reference,
            car_id: tx.car_id,
            status: tx.status,
            amount: tx.amount,
            created_at: tx.created_at,
            updated_at: tx.updated_at,
            paid_at: tx.paid_at,
            webhook_event_id: tx.webhook_event_id
          })),
          orders: orders?.map(order => ({
            id: order.id,
            order_number: order.order_number,
            transaction_id: order.transaction_id,
            status: order.status,
            amount_paid: order.amount_paid
          })) || []
        }
      });
    } catch (error) {
      console.error('[Debug] Error:', error);
      res.status(500).json({
        status: false,
        message: error.message
      });
    }
  }
);

router.get('/orders', authenticate, getUserOrdersHandler);
router.get('/orders/:orderNumber', authenticate, getOrder);

router.get('/subscriptions', authenticate, getSubscriptions);
router.post(
  '/subscriptions',
  authenticate,
  checkEmailVerified,
  paymentLimiter,
  createSubscriptionHandler
);
router.put('/subscriptions/:id/cancel', authenticate, cancelSubscriptionHandler);
router.put('/subscriptions/:id/pause', authenticate, pauseSubscriptionHandler);
router.put('/subscriptions/:id/resume', authenticate, resumeSubscriptionHandler);

export default router;
