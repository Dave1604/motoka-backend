import { Router } from 'express';
import { chat, publicChat } from '../controllers/mo.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { moChatLimiter, moPublicChatLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/mo/chat', authenticate, moChatLimiter, chat);

// Unauthenticated — the assistant on the marketing site, where every visitor
// is signed out by definition. Deliberately a different controller and a
// tighter IP-keyed limit, not the signed-in one with the guard removed.
router.post('/public/mo/chat', moPublicChatLimiter, publicChat);

export default router;
