import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import * as controller from '../controllers/driverLicenseApplication.controller.js';

const router = Router();

router.get('/driver-license-applications/me', authenticate, checkEmailVerified, apiLimiter, controller.getMyApplication);
router.put('/driver-license-applications/me', authenticate, checkEmailVerified, apiLimiter, controller.upsertApplication);

export default router;
