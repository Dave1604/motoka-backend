import { Router } from 'express';
import { chat } from '../controllers/mo.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { moChatLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/mo/chat', authenticate, moChatLimiter, chat);

export default router;
