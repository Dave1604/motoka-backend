import { getSupabaseAdmin } from '../config/supabase.js';
import { logError } from '../utils/logger.js';

/**
 * Get the current active application for a user, or create a fresh draft.
 *
 * When creating a new draft we first archive any previous current row for the
 * same (user_id, application_type) by setting is_current = false. This gives
 * the user a clean slate while preserving history.
 */
export async function getOrCreateApplication(userId, applicationType = 'new') {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await supabase
    .from('driver_license_applications')
    .select('*')
    .eq('user_id', userId)
    .eq('application_type', applicationType)
    .eq('is_current', true)
    .maybeSingle();

  if (fetchError) {
    logError('Get driver license application error', { error: fetchError, userId });
    throw fetchError;
  }
  if (existing) return existing;

  // Archive any previous rows (safety net — should already be false)
  await supabase
    .from('driver_license_applications')
    .update({ is_current: false })
    .eq('user_id', userId)
    .eq('application_type', applicationType);

  const { data: created, error: insertError } = await supabase
    .from('driver_license_applications')
    .insert({
      user_id: userId,
      application_type: applicationType,
      status: 'draft',
      is_current: true,
    })
    .select('*')
    .single();

  if (insertError) {
    logError('Create driver license application error', { error: insertError, userId });
    throw insertError;
  }
  return created;
}

/**
 * Update the current active application for a user.
 *
 * Only user-supplied fields in the allowlist can be written from this function.
 * Privileged fields (status, order_id) can be passed via the `_serverFields`
 * argument so server-side code (controllers, webhooks) can set them without
 * opening them up to user input.
 */
export async function updateApplication(userId, applicationType, updates, _serverFields = {}) {
  const supabase = getSupabaseAdmin();
  const allowed = [
    'passport_photo_url', 'license_document_url', 'full_name', 'phone', 'address',
    'date_of_birth', 'place_of_birth', 'home_of_origin', 'local_government',
    'blood_group', 'height', 'occupation', 'next_of_kin_name', 'next_of_kin_phone',
    'mother_maiden_name', 'license_years', 'license_number', 'date_of_expiry',
  ];
  const sanitized = {};
  for (const k of Object.keys(updates || {})) {
    if (allowed.includes(k) && updates[k] !== undefined) sanitized[k] = updates[k];
  }
  // Merge server-controlled fields (status, order_id) without exposing them to user input
  Object.assign(sanitized, _serverFields);
  sanitized.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('driver_license_applications')
    .update(sanitized)
    .eq('user_id', userId)
    .eq('application_type', applicationType)
    .eq('is_current', true)
    .select('*')
    .single();

  if (error) {
    logError('Update driver license application error', { error, userId });
    throw error;
  }
  return data;
}

/**
 * Get the current active application(s) for a user.
 * Returns an array when applicationType is null, a single object or null otherwise.
 */
export async function getApplicationByUserId(userId, applicationType = null) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('driver_license_applications')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('updated_at', { ascending: false });

  if (applicationType) query = query.eq('application_type', applicationType);
  const { data, error } = await query;

  if (error) {
    logError('Get driver license applications error', { error, userId });
    throw error;
  }
  return applicationType ? (data?.[0] || null) : (data || []);
}

/**
 * Start a fresh application cycle for a user (e.g. after approval they want to apply again).
 * Archives the current row and returns a new draft.
 */
export async function renewApplicationCycle(userId, applicationType) {
  const supabase = getSupabaseAdmin();

  // Archive the current row
  const { error: archiveError } = await supabase
    .from('driver_license_applications')
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('application_type', applicationType)
    .eq('is_current', true);

  if (archiveError) {
    logError('Archive driver license application error', { error: archiveError, userId });
    throw archiveError;
  }

  return getOrCreateApplication(userId, applicationType);
}
