import { getSupabaseAdmin } from '../config/supabase.js';
import { logError } from '../utils/logger.js';

const DOCUMENT_TYPE = { CAR: 'car', DRIVER_LICENSE: 'driver_license' };
const DOCUMENT_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };

/**
 * Create a document record
 */
export async function createDocument({
  userId,
  carId = null,
  orderId = null,
  documentType,
  documentCategory = null,
  description = null,
  fileUrl,
  uploadedByType = 'user',
  uploadedByUserId = null,
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      car_id: carId,
      order_id: orderId,
      document_type: documentType,
      document_category: documentCategory,
      description: description || null,
      file_url: fileUrl,
      status: DOCUMENT_STATUS.PENDING,
      uploaded_by_type: uploadedByType,
      uploaded_by_user_id: uploadedByUserId,
    })
    .select('*')
    .single();

  if (error) {
    logError('Create document error', { error, userId, documentType });
    throw error;
  }
  return data;
}

/**
 * Get documents for a user, optionally filtered by car or type
 */
export async function getUserDocuments(userId, { carId, documentType, status } = {}) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (carId != null) query = query.eq('car_id', carId);
  if (documentType) query = query.eq('document_type', documentType);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    logError('Get user documents error', { error, userId });
    throw error;
  }
  return data || [];
}

/**
 * Get documents for a car (user-facing)
 */
export async function getCarDocuments(userId, carId) {
  return getUserDocuments(userId, { carId, documentType: DOCUMENT_TYPE.CAR });
}

/**
 * Get driver's license documents for a user
 */
export async function getDriverLicenseDocuments(userId) {
  return getUserDocuments(userId, { documentType: DOCUMENT_TYPE.DRIVER_LICENSE });
}

/**
 * Update document status (admin)
 */
export async function updateDocumentStatus(documentId, status, rejectionReason = null) {
  const supabase = getSupabaseAdmin();
  const update = { status, updated_at: new Date().toISOString() };
  if (rejectionReason != null) update.rejection_reason = rejectionReason;

  const { data, error } = await supabase
    .from('documents')
    .update(update)
    .eq('id', documentId)
    .select('*')
    .single();

  if (error) {
    logError('Update document status error', { error, documentId });
    throw error;
  }
  return data;
}

/**
 * Admin: list documents with filters
 */
export async function adminListDocuments({ userId, carId, documentType, status, page = 1, limit = 20 } = {}) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('documents')
    .select('*, cars(id, slug, vehicle_make, vehicle_model, registration_no)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);
  if (carId) query = query.eq('car_id', carId);
  if (documentType) query = query.eq('document_type', documentType);
  if (status) query = query.eq('status', status);

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    logError('Admin list documents error', { error });
    throw error;
  }

  const docs = data || [];
  if (docs.length > 0) {
    const userIds = [...new Set(docs.map((d) => d.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, phone_number')
      .in('id', userIds);
    const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
    docs.forEach((d) => {
      d.user = profileMap.get(d.user_id) || null;
    });
  }

  return { documents: docs, total: count || 0 };
}

/**
 * Get single document by ID (for admin)
 */
export async function getDocumentById(documentId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('documents')
    .select('*, cars(id, slug, vehicle_make, vehicle_model, registration_no)')
    .eq('id', documentId)
    .single();

  if (error) {
    logError('Get document by ID error', { error, documentId });
    throw error;
  }
  return data;
}
