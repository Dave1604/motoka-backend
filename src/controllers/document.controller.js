import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import { createDocument, getCarDocuments, getDriverLicenseDocuments } from '../services/document.service.js';
import { uploadFile, getSignedUrl, withSignedUrls } from '../services/fileUpload.service.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { HTTP_STATUS } from '../constants/car.constants.js';

/**
 * POST /api/documents/upload
 * User uploads a document (car or driver_license)
 * Body: document_type, car_id? (required for car), document_category?, file (multipart)
 */
export const uploadDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { document_type, car_id, car_slug, document_category } = req.body;
    const file = req.file || req.files?.document?.[0] || req.files?.file?.[0];

    if (!document_type || !['car', 'driver_license'].includes(document_type)) {
      return response.error(res, 'document_type is required and must be "car" or "driver_license"', HTTP_STATUS.BAD_REQUEST);
    }

    if (document_type === 'car' && !car_id && !car_slug) {
      return response.error(res, 'car_id or car_slug is required for car documents', HTTP_STATUS.BAD_REQUEST);
    }

    if (!file || !file.buffer) {
      return response.error(res, 'No file provided', HTTP_STATUS.BAD_REQUEST);
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (document_type === 'car') {
      let carQuery = supabaseAdmin
        .from('cars')
        .select('id, slug')
        .eq('user_id', userId)
        .is('deleted_at', null);
      if (car_slug) carQuery = carQuery.eq('slug', car_slug);
      else if (car_id) carQuery = carQuery.eq('id', car_id);
      const { data: car, error: carError } = await carQuery.single();

      if (carError || !car) {
        return response.notFound(res, 'Car not found');
      }

      const fileUrl = await uploadFile(file.buffer, file.originalname, file.mimetype, userId, car.slug);
      const doc = await createDocument({
        userId,
        carId: car.id,
        documentType: 'car',
        documentCategory: document_category || null,
        fileUrl,
        uploadedByType: 'user',
      });
      const signedUrl = await getSignedUrl(doc.file_url).catch(() => null);
      return response.created(res, { document: { ...doc, file_url: signedUrl } }, 'Document uploaded successfully');
    }

    if (document_type === 'driver_license') {
      const fileUrl = await uploadFile(file.buffer, file.originalname, file.mimetype, userId, 'driver_license');
      const doc = await createDocument({
        userId,
        carId: null,
        documentType: 'driver_license',
        documentCategory: document_category || 'driver_license',
        fileUrl,
        uploadedByType: 'user',
      });
      const signedUrl = await getSignedUrl(doc.file_url).catch(() => null);
      return response.created(res, { document: { ...doc, file_url: signedUrl } }, 'Document uploaded successfully');
    }

    return response.error(res, 'Invalid document type', HTTP_STATUS.BAD_REQUEST);
  } catch (error) {
    logError('Upload document error', error);
    return response.serverError(res, error.message || 'Failed to upload document');
  }
};

/**
 * GET /api/documents/car/:carSlug
 * List car documents for the authenticated user
 */
export const listCarDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    const carSlug = req.params.carSlug;
    if (!carSlug) {
      return response.error(res, 'Car slug is required', HTTP_STATUS.BAD_REQUEST);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: car, error: carError } = await supabaseAdmin
      .from('cars')
      .select('id')
      .eq('slug', carSlug)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (carError || !car) {
      return response.notFound(res, 'Car not found');
    }

    const rawDocs = await getCarDocuments(userId, car.id);
    const documents = await withSignedUrls(rawDocs);
    return response.success(res, { documents }, 'Documents retrieved');
  } catch (error) {
    logError('List car documents error', error);
    return response.serverError(res, 'Failed to retrieve documents');
  }
};

/**
 * GET /api/documents/driver-license
 * List driver's license documents for the authenticated user
 */
export const listDriverLicenseDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { year } = req.query;
    const rawDocs = await getDriverLicenseDocuments(userId, year || null);
    const documents = await withSignedUrls(rawDocs);
    return response.success(res, { documents }, 'Documents retrieved');
  } catch (error) {
    logError('List driver license documents error', error);
    return response.serverError(res, 'Failed to retrieve documents');
  }
};
