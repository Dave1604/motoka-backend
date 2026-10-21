/**
 * FACEBOOK / INSTAGRAM MESSENGER WEBHOOK
 *
 * Mount: app.use('/api/v1/facebook', facebookRoutes)
 *
 * The POST route MUST be mounted behind express.raw() before express.json()
 * in index.js — Meta signs the exact request bytes with the app secret, and
 * express.json() would have already parsed (and thus mutated) req.body by
 * the time signature verification runs. The raw mount is path-scoped to
 * /api/v1/facebook/webhook so every other route keeps normal JSON parsing.
 */

import { Router } from 'express';
import { verify, webhook } from '../controllers/facebook.controller.js';

const router = Router();

// Meta's verification handshake — no body, no signature.
router.get('/webhook', verify);

// Inbound messages. Signature is checked inside the controller against the
// raw buffer that express.raw() preserved.
router.post('/webhook', webhook);

export default router;
