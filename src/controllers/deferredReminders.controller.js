import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import {
  createDeferredRemindersForUser,
  createDeferredRemindersForGuest
} from '../services/deferredReminders.service.js';

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export async function saveDeferredReminders(req, res) {
  try {
    const { car_slug: carSlug, reminders = [] } = req.body || {};
    if (!carSlug) return response.error(res, 'car_slug is required', 400);
    if (!Array.isArray(reminders) || reminders.length === 0) {
      return response.error(res, 'reminders must be a non-empty array', 400);
    }

    const result = await createDeferredRemindersForUser({
      userId: req.user.id,
      carSlug,
      reminders
    });

    return response.success(res, result, 'Deferred reminders saved');
  } catch (error) {
    if (error.statusCode === 404) return response.notFound(res, error.message);
    if (error.statusCode === 400) return response.error(res, error.message, 400);
    logError('[DeferredReminders] saveDeferredReminders error', error);
    return response.serverError(res, 'Failed to save deferred reminders');
  }
}

export async function saveGuestDeferredReminders(req, res) {
  try {
    const { guest_email: guestEmail, plate_number: plateNumber, reminders = [] } = req.body || {};

    if (!guestEmail || !validEmail(guestEmail)) {
      return response.error(res, 'A valid guest_email is required', 400);
    }
    if (!plateNumber?.trim()) return response.error(res, 'plate_number is required', 400);
    if (!Array.isArray(reminders) || reminders.length === 0) {
      return response.error(res, 'reminders must be a non-empty array', 400);
    }

    const result = await createDeferredRemindersForGuest({
      guestEmail,
      plateNumber,
      reminders
    });

    return response.success(res, result, 'Guest deferred reminders saved');
  } catch (error) {
    if (error.statusCode === 400) return response.error(res, error.message, 400);
    logError('[DeferredReminders] saveGuestDeferredReminders error', error);
    return response.serverError(res, 'Failed to save guest deferred reminders');
  }
}
