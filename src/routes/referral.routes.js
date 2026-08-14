import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authenticateAdmin } from '../middleware/authenticateAdmin.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import * as referral from '../controllers/referral/referral.controller.js';

const router = Router();

// Public — signup UX
router.get('/referral/validate/:code', apiLimiter, referral.validateCode);

// Authenticated user hub
router.get('/referral', authenticate, apiLimiter, referral.getMyReferral);

// Admin
router.get('/admin/referral/settings', authenticateAdmin, referral.getAdminSettings);
router.put('/admin/referral/settings', authenticateAdmin, referral.updateAdminSettings);
router.get('/admin/referral/list', authenticateAdmin, referral.listAdminReferrals);

export default router;
