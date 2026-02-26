import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import {
  getUserNotifications,
  getUserNotificationsByType,
  markNotificationAsRead,
  deleteNotification,
  markAllNotificationsAsRead
} from '../services/notification.service.js';

const router = express.Router();
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

/**
 * GET /api/notifications
 * Fetch user's notifications with pagination
 * Query params: page (default: 1), limit (default: 10), unread_only (default: false)
 */
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 10));
    const unreadOnly = req.query.unread_only === 'true';

    const result = await getUserNotifications(userId, page, limit, unreadOnly);
    return response.success(res, result, 'Notifications retrieved successfully');
  } catch (error) {
    logError('Error fetching notifications', error);
    return response.serverError(res, error.message || 'Failed to fetch notifications');
  }
});

/**
 * GET /api/notifications/type/:category
 * Fetch user's notifications filtered by category (Payments, Licenses Added, Warning, Successful)
 */
router.get('/notifications/type/:category', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const category = req.params.category || 'All';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 20));

    const result = await getUserNotificationsByType(userId, category, page, limit);
    return response.success(res, result, 'Notifications retrieved successfully');
  } catch (error) {
    logError('Error fetching notifications by type', error);
    return response.serverError(res, error.message || 'Failed to fetch notifications');
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read
 */
router.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
      return response.error(res, 'Notification ID is required', HTTP_STATUS.BAD_REQUEST);
    }

    const updatedNotification = await markNotificationAsRead(id, userId);
    return response.success(res, { notification: updatedNotification }, 'Notification marked as read');
  } catch (error) {
    logError('Error marking notification as read', error);

    if (error.message.includes('not found')) {
      return response.notFound(res, 'Notification not found');
    }

    return response.serverError(res, error.message || 'Failed to update notification');
  }
});

/**
 * PUT /api/notifications/mark-all-read
 * Mark all user notifications as read
 */
router.put('/notifications/mark-all-read', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await markAllNotificationsAsRead(userId);
    return response.success(
      res,
      { markedAsRead: count },
      `${count} notification(s) marked as read`
    );
  } catch (error) {
    logError('Error marking all notifications as read', error);
    return response.serverError(res, error.message || 'Failed to update notifications');
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete (dismiss) a notification
 */
router.delete('/notifications/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
      return response.error(res, 'Notification ID is required', HTTP_STATUS.BAD_REQUEST);
    }

    const deleted = await deleteNotification(id, userId);

    if (!deleted) {
      return response.notFound(res, 'Notification not found');
    }

    return response.success(res, null, 'Notification deleted successfully');
  } catch (error) {
    logError('Error deleting notification', error);

    if (error.message.includes('not found')) {
      return response.notFound(res, 'Notification not found');
    }

    return response.serverError(res, error.message || 'Failed to delete notification');
  }
});

export default router;
