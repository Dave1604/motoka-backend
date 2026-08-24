/**
 * GUEST ROUTES
 *
 * All routes are public (no authenticate middleware).
 * They are rate-limited to prevent abuse.
 *
 *   POST /api/guest/renewals              — initiate payment
 *   GET  /api/guest/renewals/:id/status   — poll payment status
 *   GET  /api/guest/renewals/:id/receipt  — fetch receipt (requires ?token=)
 *   POST /api/guest/renewals/:id/signup   — create account after payment
 */

import { Router } from 'express';
import { paymentLimiter, authLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { initGuestRenewal, getOrderStatus, getReceipt, verifyOrder, resendReceipt } from '../controllers/guest/guestRenewal.controller.js';
import { guestTrackOrderHandler } from '../controllers/delivery.controller.js';
import { guestSignup } from '../controllers/guest/guestSignup.controller.js';

const router = Router();

router.post('/guest/renewals', paymentLimiter, initGuestRenewal);
router.get('/guest/renewals/:orderId/status', apiLimiter, getOrderStatus);
router.post('/guest/renewals/:orderId/verify', apiLimiter, verifyOrder);
router.get('/guest/renewals/:orderId/receipt', apiLimiter, getReceipt);
router.post('/guest/renewals/:orderId/signup', authLimiter, guestSignup);
router.post('/guest/receipt/resend', authLimiter, resendReceipt);
router.get('/guest/renewals/:orderId/tracking', apiLimiter, guestTrackOrderHandler);

export default router;
