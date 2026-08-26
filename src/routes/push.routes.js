import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import {
  getVapidPublicKey,
  isWebPushConfigured,
  savePushSubscription,
  removePushSubscription,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../services/push/webPush.service.js';

const router = express.Router();

/**
 * GET /api/push/vapid-public-key
 * Public key for PushManager.subscribe (safe to expose).
 */
router.get('/push/vapid-public-key', authenticate, async (_req, res) => {
  if (!isWebPushConfigured()) {
    return response.error(res, 'Web Push is not configured on this server', 503);
  }
  return response.success(res, { publicKey: getVapidPublicKey() }, 'VAPID public key');
});

/**
 * POST /api/push/subscribe
 * Body: { endpoint, keys: { p256dh, auth } }  (PushSubscription JSON)
 */
router.post('/push/subscribe', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const subscription = req.body?.subscription || req.body;
    const saved = await savePushSubscription(userId, subscription, req.headers['user-agent']);
    return response.success(res, { id: saved.id }, 'Push subscription saved');
  } catch (error) {
    logError('Error saving push subscription', error);
    return response.serverError(res, error.message || 'Failed to save push subscription');
  }
});

/**
 * DELETE /api/push/subscribe
 * Body: { endpoint } — omit endpoint to remove all devices for this user
 */
router.delete('/push/subscribe', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const endpoint = req.body?.endpoint || req.query?.endpoint || null;
    await removePushSubscription(userId, endpoint);
    return response.success(res, null, 'Push subscription removed');
  } catch (error) {
    logError('Error removing push subscription', error);
    return response.serverError(res, error.message || 'Failed to remove push subscription');
  }
});

/**
 * GET /api/notification-preferences
 */
router.get('/notification-preferences', authenticate, async (req, res) => {
  try {
    const prefs = await getNotificationPreferences(req.user.id);
    return response.success(res, prefs, 'Notification preferences');
  } catch (error) {
    logError('Error loading notification preferences', error);
    return response.serverError(res, error.message || 'Failed to load preferences');
  }
});

/**
 * PUT /api/notification-preferences
 * Body: { push?: boolean, email?: boolean, sms?: boolean }
 */
router.put('/notification-preferences', authenticate, async (req, res) => {
  try {
    const prefs = await updateNotificationPreferences(req.user.id, {
      push: req.body?.push,
      email: req.body?.email,
      sms: req.body?.sms,
    });
    return response.success(res, prefs, 'Notification preferences updated');
  } catch (error) {
    logError('Error updating notification preferences', error);
    return response.serverError(res, error.message || 'Failed to update preferences');
  }
});

export default router;
