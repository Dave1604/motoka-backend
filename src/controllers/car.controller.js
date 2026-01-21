import { getSupabaseUser } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import { sanitizeCarInput } from '../utils/carSanitization.js';
import { checkCarDuplicates } from '../services/carDuplicateChecker.js';
import { buildCarData, buildUpdateData, extractNormalizedIdentifiers } from '../utils/carDataBuilder.js';
import { validateConditionalFields } from '../utils/carUpdateValidator.js';
import {
  createCar,
  updateCarBySlug,
  getCarBySlug as getCarBySlugService,
  getCarsPaginated,
  deleteCarBySlug as deleteCarBySlugService,
  verifyCarExists,
  CarError
} from '../services/car.service.js';
import { deleteFiles } from '../services/fileUpload.service.js';
import { handleFileUploads, getFilesToDelete, monitorFileCleanup } from '../utils/fileUploadHelper.js';
import { PAGINATION, PATTERNS, ERROR_MESSAGES, HTTP_STATUS } from '../constants/car.constants.js';

const isValidUUID = (uuid) => {
  return PATTERNS.UUID.test(uuid);
};

const handleCarError = (res, error) => {
  if (error instanceof CarError) {
    if (error.statusCode === HTTP_STATUS.NOT_FOUND) {
      return response.notFound(res, error.message);
    }
    if (error.statusCode === HTTP_STATUS.CONFLICT) {
      return response.error(res, error.message, HTTP_STATUS.CONFLICT);
    }
    if (error.statusCode === HTTP_STATUS.BAD_REQUEST) {
      return response.error(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  }
  
  logError('Car operation error', error);
  return response.serverError(res, error.message || 'An error occurred');
};

export const addCar = async (req, res) => {
  let tempFileUrls = [];
  
  try {
    const supabaseUser = getSupabaseUser(req.token);
    const userId = req.user.id;
    
    // Handle file uploads using helper
    const { uploadedFileUrls, tempFileUrls: uploadedTempUrls } = await handleFileUploads(req.uploadedFiles, userId);
    tempFileUrls = uploadedTempUrls;
    Object.assign(req.body, uploadedFileUrls);

    const sanitizedBody = sanitizeCarInput(req.body);
    const identifiers = extractNormalizedIdentifiers(sanitizedBody);
    
    const duplicateCheck = await checkCarDuplicates(
      identifiers.registration_no,
      identifiers.chasis_no,
      identifiers.engine_no
    );
    
    if (duplicateCheck.hasDuplicates) {
      await deleteFiles(tempFileUrls);
      return response.error(res, duplicateCheck.message, HTTP_STATUS.CONFLICT);
    }
    
    const carData = buildCarData(sanitizedBody, userId);
    const car = await createCar(supabaseUser, carData);
    
    return response.created(res, { car }, 'Car registered successfully');
  } catch (error) {
    // Monitor and cleanup temp files on error
    await monitorFileCleanup(tempFileUrls, 'addCar');
    return handleCarError(res, error);
  }
};

export const getCars = async (req, res) => {
  try {
    const supabaseUser = getSupabaseUser(req.token);
    
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    
    if (pageParam !== undefined) {
      if (!PATTERNS.POSITIVE_INTEGER.test(String(pageParam))) {
        return response.error(res, ERROR_MESSAGES.INVALID_PAGE, HTTP_STATUS.BAD_REQUEST);
      }
      const parsedPage = parseInt(pageParam, 10);
      if (parsedPage < PAGINATION.MIN_PAGE || parsedPage > PAGINATION.MAX_PAGE) {
        return response.error(res, ERROR_MESSAGES.PAGE_OUT_OF_RANGE, HTTP_STATUS.BAD_REQUEST);
      }
    }
    
    if (limitParam !== undefined) {
      if (!PATTERNS.POSITIVE_INTEGER.test(String(limitParam))) {
        return response.error(res, ERROR_MESSAGES.INVALID_LIMIT, HTTP_STATUS.BAD_REQUEST);
      }
      const parsedLimit = parseInt(limitParam, 10);
      if (parsedLimit < PAGINATION.MIN_LIMIT || parsedLimit > PAGINATION.MAX_LIMIT) {
        return response.error(res, ERROR_MESSAGES.LIMIT_OUT_OF_RANGE, HTTP_STATUS.BAD_REQUEST);
      }
    }
    
    const page = Math.max(PAGINATION.MIN_PAGE, parseInt(pageParam, 10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(PAGINATION.MIN_LIMIT, parseInt(limitParam, 10) || PAGINATION.DEFAULT_LIMIT));
    
    const result = await getCarsPaginated(supabaseUser, page, limit);
    
    return response.success(res, result, 'Cars retrieved successfully');
  } catch (error) {
    return handleCarError(res, error);
  }
};

export const getCarBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    
    if (!slug || !isValidUUID(slug)) {
      return response.error(res, ERROR_MESSAGES.INVALID_SLUG, HTTP_STATUS.BAD_REQUEST);
    }
    
    const supabaseUser = getSupabaseUser(req.token);
    const car = await getCarBySlugService(supabaseUser, slug, userId);
    
    return response.success(res, { car }, 'Car retrieved successfully');
  } catch (error) {
    return handleCarError(res, error);
  }
};

export const updateCar = async (req, res) => {
  let tempFileUrls = [];
  
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    
    if (!slug || !isValidUUID(slug)) {
      return response.error(res, ERROR_MESSAGES.INVALID_SLUG, HTTP_STATUS.BAD_REQUEST);
    }
    
    const supabaseUser = getSupabaseUser(req.token);
    const existingCar = await verifyCarExists(supabaseUser, slug, userId);
    
    // Handle file uploads using helper
    const { uploadedFileUrls, tempFileUrls: uploadedTempUrls } = await handleFileUploads(req.uploadedFiles, userId, slug);
    tempFileUrls = uploadedTempUrls;
    
    // Get files to delete (old files being replaced)
    const filesToDelete = getFilesToDelete(existingCar, uploadedFileUrls);
    
    Object.assign(req.body, uploadedFileUrls);
    
    const sanitizedBody = sanitizeCarInput(req.body);
    
    // Validate conditional fields based on existing car state
    const validationErrors = validateConditionalFields(sanitizedBody, existingCar);
    if (validationErrors.length > 0) {
      await deleteFiles(tempFileUrls);
      return response.validationError(res, validationErrors);
    }
    
    const identifiers = extractNormalizedIdentifiers(sanitizedBody, existingCar);
    
    const hasIdentifierUpdate = 
      sanitizedBody.registration_no !== undefined ||
      sanitizedBody.chasis_no !== undefined ||
      sanitizedBody.engine_no !== undefined;
    
    if (hasIdentifierUpdate) {
      const checkRegistrationNo = sanitizedBody.registration_no !== undefined ? identifiers.registration_no : null;
      const checkChasisNo = sanitizedBody.chasis_no !== undefined ? identifiers.chasis_no : null;
      const checkEngineNo = sanitizedBody.engine_no !== undefined ? identifiers.engine_no : null;
      
      const duplicateCheck = await checkCarDuplicates(
        checkRegistrationNo,
        checkChasisNo,
        checkEngineNo,
        existingCar.id
      );
      
      if (duplicateCheck.hasDuplicates) {
        await deleteFiles(tempFileUrls);
        return response.error(res, duplicateCheck.message, HTTP_STATUS.CONFLICT);
      }
    }
    
    const updateData = buildUpdateData(sanitizedBody, existingCar);
    const updatedCar = await updateCarBySlug(supabaseUser, slug, userId, updateData, identifiers);
    
    // Delete old files after successful update
    if (filesToDelete.length > 0) {
      await monitorFileCleanup(filesToDelete, 'updateCar-oldFiles');
    }
    
    return response.success(res, { car: updatedCar }, 'Car updated successfully');
  } catch (error) {
    // Monitor and cleanup temp files on error
    await monitorFileCleanup(tempFileUrls, 'updateCar');
    return handleCarError(res, error);
  }
};

export const deleteCar = async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    
    if (!slug || !isValidUUID(slug)) {
      return response.error(res, ERROR_MESSAGES.INVALID_SLUG, HTTP_STATUS.BAD_REQUEST);
    }
    
    const supabaseUser = getSupabaseUser(req.token);
    await verifyCarExists(supabaseUser, slug, userId);
    await deleteCarBySlugService(supabaseUser, slug, userId);
    
    return response.success(res, null, 'Car deleted successfully');
  } catch (error) {
    return handleCarError(res, error);
  }
};
