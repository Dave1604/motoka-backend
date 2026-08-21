import express, { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { verifyPaystackWebhook } from '../middleware/verifyPaystackWebhook.js';
import { verifyMonipayWebhook } from '../middleware/verifyMonipayWebhook.js';
import { verifyMonicreditWebhook } from '../middleware/verifyMonicreditWebhook.js';
import { verifyShipbubbleWebhook } from '../middleware/verifyShipbubbleWebhook.js';
import { paymentLimiter, webhookLimiter } from '../middleware/rateLimiter.js';
import {
  initializePayment,
  getRenewalItems,
  getPaymentHeads,
  getStates,
  getLGAs,
  getPaymentConfig
} from '../controllers/payment/payment-init.controller.js';

import {
  verifyPayment,
  getTransaction,
  getTransactionStatus,
  cancelPayment,
  retryPayment
} from '../controllers/payment/payment-verification.controller.js';

import {
  getPaymentHistory,
  getCarPayments,
  getCarPaymentReceipt,
  checkExistingPayments
} from '../controllers/payment/payment-status.controller.js';

import {
  handlePaystackWebhook,
  handleMonipayWebhook,
  handleMonicreditWebhook
} from '../controllers/payment/webhook.controller.js';
import { handleShipbubbleWebhook } from '../controllers/courier/shipbubbleWebhook.controller.js';

import {
  getUserOrdersHandler,
  getOrder
} from '../controllers/payment/order.controller.js';

import {
  getSubscriptions,
  createSubscriptionHandler,
  cancelSubscriptionHandler,
  pauseSubscriptionHandler,
  resumeSubscriptionHandler,
  initiateTokenization
} from '../controllers/payment/subscription.controller.js';

import { setupCardForValidCar } from '../controllers/payment/subscriptionSetup.controller.js';

import {
  getBanks,
  getPaymentMethods,
  getPendingTokenizationSubscriptions
} from '../controllers/payment/paymentMethods.controller.js';
import { quoteDeliveryHandler, userTrackOrderHandler } from '../controllers/delivery.controller.js';

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

router.post(
  '/webhooks/paystack',
  webhookLimiter,
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

router.post(
  '/webhooks/monipay',
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '2mb' }),
  verifyMonipayWebhook,
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
  handleMonipayWebhook
);

router.post(
  '/webhooks/shipbubble',
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '2mb' }),
  verifyShipbubbleWebhook,
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
  handleShipbubbleWebhook
);

router.post(
  '/webhooks/monicredit',
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '2mb' }),
  verifyMonicreditWebhook,
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
  handleMonicreditWebhook
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
  checkEmailVerified,
  paymentLimiter,
  verifyPayment
);

router.get('/payments/history', authenticate, getPaymentHistory);
router.get('/payments/car/:slug', authenticate, getCarPayments);
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

router.post(
  '/payment/verify-payment/:reference',
  authenticate,
  checkEmailVerified,
  paymentLimiter,
  verifyPayment
);

router.post('/payment/check-existing', authenticate, checkExistingPayments);
router.get('/payment/car-receipt/:identifier', authenticate, getCarPaymentReceipt);

router.post('/delivery/quote', authenticate, paymentLimiter, quoteDeliveryHandler);
router.get('/orders', authenticate, getUserOrdersHandler);
router.get('/orders/:orderNumber/tracking', authenticate, userTrackOrderHandler);
router.get('/orders/:orderNumber', authenticate, getOrder);

router.get('/subscriptions', authenticate, getSubscriptions);
router.post(
  '/subscriptions/card-setup',
  authenticate,
  checkEmailVerified,
  paymentLimiter,
  setupCardForValidCar
);
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
router.post('/subscriptions/:id/tokenize', authenticate, checkEmailVerified, paymentLimiter, initiateTokenization);

router.get('/banks', getBanks);
router.get('/payment-methods', authenticate, getPaymentMethods);
router.get('/payment-methods/pending-tokenization', authenticate, getPendingTokenizationSubscriptions);

export default router;
