/**
 * PUBLIC ROUTES
 *
 * No authentication required. Serves reference data needed by the
 * guest renewal modal before any payment is initiated.
 */

import { Router } from 'express';
import { apiLimiter, contactLimiter } from '../middleware/rateLimiter.js';
import { listRenewalItems, listStates, listLGAs, submitContact } from '../controllers/public.controller.js';

const router = Router();

router.get('/public/renewal-items', apiLimiter, listRenewalItems);
router.get('/public/states', apiLimiter, listStates);
router.get('/public/states/:stateCode/lgas', apiLimiter, listLGAs);
router.post('/public/contact', contactLimiter, submitContact);

export default router;
