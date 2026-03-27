import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { apiLimiter, authLimiter } from '../middleware/rateLimiter.js';
import {
  saveDeferredReminders,
  saveGuestDeferredReminders
} from '../controllers/deferredReminders.controller.js';

const router = Router();

router.post('/renewals/deferred-reminders', authenticate, apiLimiter, saveDeferredReminders);
router.post('/guest/renewals/deferred-reminders', authLimiter, saveGuestDeferredReminders);

export default router;
