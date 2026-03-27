import { getSupabaseAdmin } from '../config/supabase.js';

function normalizeReason(reason) {
  const value = String(reason || '').trim().toLowerCase();
  if (['skipped', 'not_expired', 'already_handled', 'custom'].includes(value)) return value;
  return 'skipped';
}

function sanitizeReminder(reminder = {}) {
  const reason = normalizeReason(reminder.reason);
  return {
    document_name: String(reminder.document_name || '').trim(),
    reason,
    expiry_date: reminder.expiry_date || null,
    custom_reason: reason === 'custom' ? String(reminder.custom_reason || '').trim() || null : null
  };
}

export async function createDeferredRemindersForUser({ userId, carSlug, reminders = [] }) {
  const supabase = getSupabaseAdmin();
  const normalized = reminders.map(sanitizeReminder).filter((item) => item.document_name);

  if (!normalized.length) return { inserted: 0 };

  const { data: car, error: carError } = await supabase
    .from('cars')
    .select('id, slug')
    .eq('slug', carSlug)
    .eq('user_id', userId)
    .single();

  if (carError || !car) {
    throw Object.assign(new Error('Car not found'), { statusCode: 404 });
  }

  const payload = normalized.map((item) => ({
    user_id: userId,
    car_id: car.id,
    document_name: item.document_name,
    reason: item.reason,
    expiry_date: item.expiry_date,
    custom_reason: item.custom_reason
  }));

  const { error } = await supabase.from('deferred_document_reminders').insert(payload);
  if (error) {
    throw Object.assign(new Error('Failed to save deferred reminders'), { statusCode: 500 });
  }

  return { inserted: payload.length };
}

export async function createDeferredRemindersForGuest({ guestEmail, plateNumber, reminders = [] }) {
  const supabase = getSupabaseAdmin();
  const normalized = reminders.map(sanitizeReminder).filter((item) => item.document_name);

  if (!normalized.length) return { inserted: 0 };

  const payload = normalized.map((item) => ({
    guest_email: String(guestEmail).trim().toLowerCase(),
    plate_number: String(plateNumber).trim().toUpperCase(),
    document_name: item.document_name,
    reason: item.reason,
    expiry_date: item.expiry_date,
    custom_reason: item.custom_reason
  }));

  const { error } = await supabase.from('deferred_document_reminders').insert(payload);
  if (error) {
    throw Object.assign(new Error('Failed to save deferred reminders'), { statusCode: 500 });
  }

  return { inserted: payload.length };
}
