import { getSupabaseAdmin } from '../config/supabase.js';
import { logError } from '../utils/logger.js';

/**
 * NOTIFICATION SERVICE
 * 
 * Handles creation and management of in-app notifications
 * stored in the notifications table with RLS policies enforced by Supabase
 * 
 * NOTE: The notifications table uses user_id (VARCHAR 6-char from profiles.user_id, NOT auth.users.id)
 * So we need to fetch the custom user_id from the profiles table first
 */

/**
 * Helper function to get user's custom user_id (6-char) from their auth UUID
 * 
 * @param {string} userId - User UUID from auth.users
 * @returns {Promise<string>} Custom 6-char user_id from profiles table
 */
async function getUserCustomId(userId) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new Error(`Failed to fetch user profile: ${error?.message || 'User not found'}`);
    }

    return profile.user_id;
  } catch (error) {
    logError('Failed to get custom user ID', error);
    throw error;
  }
}

/**
 * Create an in-app notification for a user
 * 
 * @param {string} userId - User UUID from auth.users
 * @param {string} type - Notification type (e.g., 'welcome', 'car_approved', 'car_rejected')
 * @param {string} action - Specific action (e.g., 'first_car_registered', 'car_created')
 * @param {string} message - Human-readable notification message
 * @param {Object} [data] - Optional additional data/metadata (stored as JSONB)
 * @returns {Promise<Object>} Created notification object
 * @throws {Error} If notification creation fails
 */
export async function createInAppNotification(userId, type, action, message, data = null) {
  try {
    // Get the custom user_id (6-char) from profiles table
    const customUserId = await getUserCustomId(userId);
    
    const supabaseAdmin = getSupabaseAdmin();
    
    const notificationPayload = {
      user_id: customUserId,
      type,
      action,
      message,
      data,
      is_read: false
    };

    const { data: createdNotification, error } = await supabaseAdmin
      .from('notifications')
      .insert([notificationPayload])
      .select('*')
      .single();

    if (error) {
      logError('Failed to create in-app notification', {
        userId,
        customUserId,
        type,
        action,
        error: error.message
      });
      throw new Error(`Failed to create notification: ${error.message}`);
    }

    console.log('[Notification Service] In-app notification created:', {
      id: createdNotification.id,
      userId,
      type,
      action
    });

    return createdNotification;
  } catch (error) {
    logError('Notification Service Error', error);
    throw error;
  }
}

/**
 * Get user's notifications with pagination
 * 
 * @param {string} userId - User UUID from auth.users
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @param {boolean} [unreadOnly=false] - Fetch only unread notifications
 * @returns {Promise<Object>} Paginated notifications with metadata
 */
export async function getUserNotifications(userId, page = 1, limit = 10, unreadOnly = false) {
  try {
    // Get the custom user_id (6-char) from profiles table
    const customUserId = await getUserCustomId(userId);
    
    const supabaseAdmin = getSupabaseAdmin();
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', customUserId)
      .order('created_at', { ascending: false });

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data: notifications, count, error } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      logError('Failed to fetch notifications', { userId, error: error.message });
      throw new Error(`Failed to fetch notifications: ${error.message}`);
    }

    return {
      notifications: notifications || [],
      pagination: {
        total: count || 0,
        page,
        limit,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    logError('Notification Service Error', error);
    throw error;
  }
}

/**
 * Get user's notifications filtered by type/category
 * Maps UI categories (Payments, Licenses Added, etc.) to DB type/action filters
 *
 * @param {string} userId - User UUID from auth.users
 * @param {string} category - UI category: 'All' | 'Payments' | 'Licenses Added' | 'Warning' | 'Successful'
 * @param {number} [page=1] - Page number
 * @param {number} [limit=20] - Items per page
 * @returns {Promise<Object>} Same shape as getUserNotifications
 */
export async function getUserNotificationsByType(userId, category, page = 1, limit = 20) {
  try {
    const customUserId = await getUserCustomId(userId);
    const supabaseAdmin = getSupabaseAdmin();
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', customUserId)
      .order('created_at', { ascending: false });

    // Map UI category to DB filters
    switch (category) {
      case 'Payments':
        query = query.eq('type', 'payment');
        break;
      case 'Licenses Added':
        query = query.eq('type', 'car');
        break;
      case 'Warning':
        query = query.or('type.eq.warning,action.eq.warning');
        break;
      case 'Successful':
        query = query.in('action', [
          'completed',
          'success',
          'created',
          'payment_success',
          'ladipo_payment_success',
        ]);
        break;
      default:
        // 'All' or unknown - no extra filter
        break;
    }

    const { data: notifications, count, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      logError('Failed to fetch notifications by type', { userId, category, error: error.message });
      throw new Error(`Failed to fetch notifications: ${error.message}`);
    }

    return {
      notifications: notifications || [],
      pagination: {
        total: count || 0,
        page,
        limit,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    logError('Notification Service Error', error);
    throw error;
  }
}

/**
 * Mark a notification as read
 * 
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User UUID (for validation)
 * @returns {Promise<Object>} Updated notification
 */
export async function markNotificationAsRead(notificationId, userId) {
  try {
    // Get the custom user_id (6-char) from profiles table for verification
    const customUserId = await getUserCustomId(userId);
    
    const supabaseAdmin = getSupabaseAdmin();

    const { data: updated, error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', customUserId)
      .select('*')
      .single();

    if (error) {
      logError('Failed to mark notification as read', {
        notificationId,
        userId,
        error: error.message
      });
      throw new Error(`Failed to update notification: ${error.message}`);
    }

    if (!updated) {
      throw new Error('Notification not found or unauthorized');
    }

    return updated;
  } catch (error) {
    logError('Notification Service Error', error);
    throw error;
  }
}

/**
 * Delete (dismiss) a notification
 * 
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User UUID (for validation)
 * @returns {Promise<boolean>} True if deleted successfully
 */
export async function deleteNotification(notificationId, userId) {
  try {
    // Get the custom user_id (6-char) from profiles table for verification
    const customUserId = await getUserCustomId(userId);
    
    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', customUserId);

    if (error) {
      logError('Failed to delete notification', {
        notificationId,
        userId,
        error: error.message
      });
      throw new Error(`Failed to delete notification: ${error.message}`);
    }

    console.log('[Notification Service] Notification deleted:', { id: notificationId });
    return true;
  } catch (error) {
    logError('Notification Service Error', error);
    throw error;
  }
}

/**
 * Mark all user notifications as read
 * 
 * @param {string} userId - User UUID
 * @returns {Promise<number>} Number of notifications marked as read
 */
export async function markAllNotificationsAsRead(userId) {
  try {
    // Get the custom user_id (6-char) from profiles table
    const customUserId = await getUserCustomId(userId);
    
    const supabaseAdmin = getSupabaseAdmin();

    const { count, error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', customUserId)
      .eq('is_read', false);

    if (error) {
      logError('Failed to mark all notifications as read', { userId, error: error.message });
      throw new Error(`Failed to update notifications: ${error.message}`);
    }

    console.log('[Notification Service] All notifications marked as read:', {
      userId,
      count: count || 0
    });

    return count || 0;
  } catch (error) {
    logError('Notification Service Error', error);
    throw error;
  }
}
