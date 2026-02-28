import { getSupabaseAdmin } from '../config/supabase.js';
import { logError } from '../utils/logger.js';

export async function getOrCreateApplication(userId, applicationType = 'new') {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: fetchError } = await supabase
    .from('driver_license_applications')
    .select('*')
    .eq('user_id', userId)
    .eq('application_type', applicationType)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    logError('Get driver license application error', { error: fetchError, userId });
    throw fetchError;
  }
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('driver_license_applications')
    .insert({
      user_id: userId,
      application_type: applicationType,
      status: 'draft',
    })
    .select('*')
    .single();

  if (insertError) {
    logError('Create driver license application error', { error: insertError, userId });
    throw insertError;
  }
  return created;
}

export async function updateApplication(userId, applicationType, updates) {
  const supabase = getSupabaseAdmin();
  const allowed = [
    'passport_photo_url', 'license_document_url', 'full_name', 'phone', 'address',
    'date_of_birth', 'place_of_birth', 'home_of_origin', 'local_government',
    'blood_group', 'height', 'occupation', 'next_of_kin_name', 'next_of_kin_phone',
    'mother_maiden_name', 'license_years', 'license_number', 'date_of_expiry',
    'status', 'order_id',
  ];
  const sanitized = {};
  for (const k of Object.keys(updates || {})) {
    if (allowed.includes(k) && updates[k] !== undefined) sanitized[k] = updates[k];
  }
  sanitized.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('driver_license_applications')
    .update(sanitized)
    .eq('user_id', userId)
    .eq('application_type', applicationType)
    .select('*')
    .single();

  if (error) {
    logError('Update driver license application error', { error, userId });
    throw error;
  }
  return data;
}

export async function getApplicationByUserId(userId, applicationType = null) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('driver_license_applications')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (applicationType) query = query.eq('application_type', applicationType);
  const { data, error } = await query;

  if (error) {
    logError('Get driver license applications error', { error, userId });
    throw error;
  }
  return applicationType ? (data?.[0] || null) : (data || []);
}
