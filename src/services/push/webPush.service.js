import webpush from 'web-push';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo, logWarn } from '../../utils/logger.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:trymotokaapp@gmail.com';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://motokaapp.ng').replace(/\/$/, '');

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || null;
}

export function isWebPushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

/**
 * Save or update a browser push subscription for a user.
 */
export async function savePushSubscription(userId, subscription, userAgent = null) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Invalid push subscription payload');
  }

  const supabaseAdmin = getSupabaseAdmin();
  const row = {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent,
    updated_at: new Date().toISOString(),
  };

  // A push endpoint belongs to a browser, not an account, so a second user
  // signing in on the same device legitimately re-registers the same endpoint
  // and the row has to move to them. That also means anyone holding a leaked
  // endpoint could point it at their own account, so record the handover and
  // clear the previous owner's push flag rather than leaving them marked as
  // subscribed with no device.
  const { data: existing } = await supabaseAdmin
    .from('push_subscriptions')
    .select('user_id')
    .eq('endpoint', subscription.endpoint)
    .maybeSingle();

  const previousOwnerId = existing?.user_id && existing.user_id !== userId ? existing.user_id : null;

  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' })
    .select('*')
    .single();

  if (error) {
    logError('Failed to save push subscription', { userId, error: error.message });
    throw new Error(`Failed to save push subscription: ${error.message}`);
  }

  if (previousOwnerId) {
    logWarn('Push endpoint reassigned to a different user', { userId, previousOwnerId });

    const { count } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', previousOwnerId);

    if (!count) {
      await supabaseAdmin
        .from('profiles')
        .update({ notify_push: false })
        .eq('id', previousOwnerId);
    }
  }

  // Opt user into push prefs when they grant permission
  await supabaseAdmin
    .from('profiles')
    .update({ notify_push: true })
    .eq('id', userId);

  return data;
}

/**
 * Remove a subscription by endpoint (and optionally disable push if none left).
 */
export async function removePushSubscription(userId, endpoint) {
  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin.from('push_subscriptions').delete().eq('user_id', userId);
  if (endpoint) {
    query = query.eq('endpoint', endpoint);
  }

  const { error } = await query;
  if (error) {
    logError('Failed to remove push subscription', { userId, error: error.message });
    throw new Error(`Failed to remove push subscription: ${error.message}`);
  }

  const { count } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (!count) {
    await supabaseAdmin
      .from('profiles')
      .update({ notify_push: false })
      .eq('id', userId);
  }

  return true;
}

export async function getNotificationPreferences(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('notify_push, notify_email, notify_sms')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`Failed to load notification preferences: ${error.message}`);
  }

  return {
    push: Boolean(data?.notify_push),
    email: data?.notify_email !== false,
    sms: Boolean(data?.notify_sms),
  };
}

export async function updateNotificationPreferences(userId, prefs = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  const patch = {};
  if (typeof prefs.push === 'boolean') patch.notify_push = prefs.push;
  if (typeof prefs.email === 'boolean') patch.notify_email = prefs.email;
  if (typeof prefs.sms === 'boolean') patch.notify_sms = prefs.sms;

  if (Object.keys(patch).length === 0) {
    return getNotificationPreferences(userId);
  }

  const { error } = await supabaseAdmin.from('profiles').update(patch).eq('id', userId);
  if (error) {
    throw new Error(`Failed to update notification preferences: ${error.message}`);
  }

  // Turning push off → drop all device subscriptions
  if (prefs.push === false) {
    await removePushSubscription(userId, null);
  }

  return getNotificationPreferences(userId);
}

function titleForNotification(type, action) {
  const t = (type || '').toLowerCase();
  const a = (action || '').toLowerCase();
  if (t === 'payment' || a.includes('payment')) return 'Payment update';
  if (t === 'car' || a.includes('car')) return 'Vehicle update';
  if (t === 'warning' || a.includes('fail')) return 'Important alert';
  if (a.includes('ladipo') || t === 'ladipo') return 'Ladipo order';
  if (a.includes('expiry') || a.includes('renew')) return 'Renewal reminder';
  if (a.includes('referral')) return 'Referral update';
  return 'Motoka';
}

function urlForNotification(type, action, data) {
  if (data?.url && typeof data.url === 'string') return data.url;
  const a = (action || '').toLowerCase();
  if (a.includes('ladipo')) return '/notifications';
  if ((type || '').toLowerCase() === 'payment') return '/notifications';
  return '/notifications';
}

/**
 * Send a Web Push to all of a user's devices.
 * Safe to call fire-and-forget — never throws to callers.
 */
export async function sendWebPushToUser(userId, { title, body, url, tag, data } = {}) {
  try {
    if (!ensureVapid()) {
      logWarn('Web Push skipped — VAPID keys not configured');
      return { sent: 0, skipped: true };
    }

    const prefs = await getNotificationPreferences(userId);
    if (!prefs.push) {
      return { sent: 0, skipped: true, reason: 'prefs_off' };
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: subs, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      logError('Failed to load push subscriptions', { userId, error: error.message });
      return { sent: 0, error: error.message };
    }

    if (!subs?.length) {
      return { sent: 0, skipped: true, reason: 'no_subscriptions' };
    }

    const payload = JSON.stringify({
      title: title || 'Motoka',
      body: body || '',
      url: url ? (url.startsWith('http') ? url : `${FRONTEND_URL}${url}`) : `${FRONTEND_URL}/notifications`,
      tag: tag || 'motoka-notification',
      data: data || {},
    });

    let sent = 0;
    for (const sub of subs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent += 1;
      } catch (err) {
        const status = err?.statusCode;
        // Gone / expired subscription — clean up
        if (status === 404 || status === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
          logInfo('Removed expired push subscription', { userId, endpoint: sub.endpoint });
        } else {
          logError('Web Push send failed', {
            userId,
            status,
            message: err?.message,
          });
        }
      }
    }

    return { sent };
  } catch (error) {
    logError('sendWebPushToUser failed', error);
    return { sent: 0, error: error.message };
  }
}

/**
 * Push after an in-app notification is created (non-blocking).
 */
export function pushFromInAppNotification(userId, type, action, message, data = null) {
  // Fire and forget — never block payment / order flows
  setImmediate(() => {
    sendWebPushToUser(userId, {
      title: titleForNotification(type, action),
      body: message,
      url: urlForNotification(type, action, data),
      tag: `motoka-${type || 'general'}-${action || 'update'}`,
      data: { type, action, ...(data && typeof data === 'object' ? data : {}) },
    }).catch(() => {});
  });
}
