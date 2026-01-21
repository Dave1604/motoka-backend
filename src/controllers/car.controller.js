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
import { uploadFiles, uploadFile, deleteFiles, deleteFile } from '../services/fileUpload.service.js';

const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const handleCarError = (res, error) => {
  if (error instanceof CarError) {
    if (error.statusCode === 404) {
      return response.notFound(res, error.message);
    }
    if (error.statusCode === 409) {
      return response.error(res, error.message, 409);
    }
    if (error.statusCode === 400) {
      return response.error(res, error.message, 400);
    }
  }
  
  logError('Car operation error', error);
  return response.serverError(res, error.message || 'An error occurred');
};

export const addCar = async (req, res) => {
  const uploadedFileUrls = {};
  const tempFileUrls = [];
  
  try {
    const supabaseUser = getSupabaseUser(req.token);
    const userId = req.user.id;
    
    if (req.uploadedFiles) {
      if (req.uploadedFiles.document_images && req.uploadedFiles.document_images.length > 0) {
        const urls = await uploadFiles(req.uploadedFiles.document_images, userId);
        uploadedFileUrls.document_images = urls;
        tempFileUrls.push(...urls);
      }
      
      if (req.uploadedFiles.cac_document && req.uploadedFiles.cac_document.length > 0) {
        const url = await uploadFile(
          req.uploadedFiles.cac_document[0].buffer,
          req.uploadedFiles.cac_document[0].originalname,
          req.uploadedFiles.cac_document[0].mimetype,
          userId
        );
        uploadedFileUrls.cac_document = url;
        tempFileUrls.push(url);
      }
      
      if (req.uploadedFiles.letterhead && req.uploadedFiles.letterhead.length > 0) {
        const url = await uploadFile(
          req.uploadedFiles.letterhead[0].buffer,
          req.uploadedFiles.letterhead[0].originalname,
          req.uploadedFiles.letterhead[0].mimetype,
          userId
        );
        uploadedFileUrls.letterhead = url;
        tempFileUrls.push(url);
      }
      
      if (req.uploadedFiles.means_of_identification && req.uploadedFiles.means_of_identification.length > 0) {
        const url = await uploadFile(
          req.uploadedFiles.means_of_identification[0].buffer,
          req.uploadedFiles.means_of_identification[0].originalname,
          req.uploadedFiles.means_of_identification[0].mimetype,
          userId
        );
        uploadedFileUrls.means_of_identification = url;
        tempFileUrls.push(url);
      }
      
      Object.assign(req.body, uploadedFileUrls);
    }

    const sanitizedBody = sanitizeCarInput(req.body);
    const identifiers = extractNormalizedIdentifiers(sanitizedBody);
    
    const duplicateCheck = await checkCarDuplicates(
      identifiers.registration_no,
      identifiers.chasis_no,
      identifiers.engine_no
    );
    
    if (duplicateCheck.hasDuplicates) {
      await deleteFiles(tempFileUrls);
      return response.error(res, duplicateCheck.message, 409);
    }
    
    const carData = buildCarData(sanitizedBody, userId);
    const car = await createCar(supabaseUser, carData);
    
    return response.created(res, { car }, 'Car registered successfully');
  } catch (error) {
    if (tempFileUrls.length > 0) {
      await deleteFiles(tempFileUrls).catch(err => {
        logError('Failed to cleanup temp files', err);
      });
    }
    return handleCarError(res, error);
  }
};

export const getCars = async (req, res) => {
  try {
    const supabaseUser = getSupabaseUser(req.token);
    
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    
    if (pageParam !== undefined) {
      if (!/^\d+$/.test(String(pageParam))) {
        return response.error(res, 'Invalid page parameter. Must be a positive integer.', 400);
      }
      const parsedPage = parseInt(pageParam, 10);
      if (parsedPage < 1 || parsedPage > 100000) {
        return response.error(res, 'Page parameter must be between 1 and 100000.', 400);
      }
    }
    
    if (limitParam !== undefined) {
      if (!/^\d+$/.test(String(limitParam))) {
        return response.error(res, 'Invalid limit parameter. Must be a positive integer.', 400);
      }
      const parsedLimit = parseInt(limitParam, 10);
      if (parsedLimit < 1 || parsedLimit > 100) {
        return response.error(res, 'Limit parameter must be between 1 and 100.', 400);
      }
    }
    
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10) || 10));
    
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
      return response.error(res, 'Invalid slug format', 400);
    }
    
    const supabaseUser = getSupabaseUser(req.token);
    const car = await getCarBySlugService(supabaseUser, slug, userId);
    
    return response.success(res, { car }, 'Car retrieved successfully');
  } catch (error) {
    return handleCarError(res, error);
  }
};

export const updateCar = async (req, res) => {
  const uploadedFileUrls = {};
  const tempFileUrls = [];
  const filesToDelete = [];
  
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    
    if (!slug || !isValidUUID(slug)) {
      return response.error(res, 'Invalid slug format', 400);
    }
    
    const supabaseUser = getSupabaseUser(req.token);
    const existingCar = await verifyCarExists(supabaseUser, slug, userId);
    
    if (req.uploadedFiles) {
      if (req.uploadedFiles.document_images && req.uploadedFiles.document_images.length > 0) {
        const urls = await uploadFiles(req.uploadedFiles.document_images, userId, slug);
        uploadedFileUrls.document_images = urls;
        tempFileUrls.push(...urls);
        
        if (existingCar.document_images && Array.isArray(existingCar.document_images)) {
          filesToDelete.push(...existingCar.document_images);
        }
      }
      
      if (req.uploadedFiles.cac_document && req.uploadedFiles.cac_document.length > 0) {
        const url = await uploadFile(
          req.uploadedFiles.cac_document[0].buffer,
          req.uploadedFiles.cac_document[0].originalname,
          req.uploadedFiles.cac_document[0].mimetype,
          userId,
          slug
        );
        uploadedFileUrls.cac_document = url;
        tempFileUrls.push(url);
        
        if (existingCar.cac_document) {
          filesToDelete.push(existingCar.cac_document);
        }
      }
      
      if (req.uploadedFiles.letterhead && req.uploadedFiles.letterhead.length > 0) {
        const url = await uploadFile(
          req.uploadedFiles.letterhead[0].buffer,
          req.uploadedFiles.letterhead[0].originalname,
          req.uploadedFiles.letterhead[0].mimetype,
          userId,
          slug
        );
        uploadedFileUrls.letterhead = url;
        tempFileUrls.push(url);
        
        if (existingCar.letterhead) {
          filesToDelete.push(existingCar.letterhead);
        }
      }
      
      if (req.uploadedFiles.means_of_identification && req.uploadedFiles.means_of_identification.length > 0) {
        const url = await uploadFile(
          req.uploadedFiles.means_of_identification[0].buffer,
          req.uploadedFiles.means_of_identification[0].originalname,
          req.uploadedFiles.means_of_identification[0].mimetype,
          userId,
          slug
        );
        uploadedFileUrls.means_of_identification = url;
        tempFileUrls.push(url);
        
        if (existingCar.means_of_identification) {
          filesToDelete.push(existingCar.means_of_identification);
        }
      }
      
      Object.assign(req.body, uploadedFileUrls);
    }
    
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
        return response.error(res, duplicateCheck.message, 409);
      }
    }
    
    const updateData = buildUpdateData(sanitizedBody, existingCar);
    const updatedCar = await updateCarBySlug(supabaseUser, slug, userId, updateData, identifiers);
    
    if (filesToDelete.length > 0) {
      await deleteFiles(filesToDelete).catch(err => {
        logError('Failed to delete old files', err);
      });
    }
    
    return response.success(res, { car: updatedCar }, 'Car updated successfully');
  } catch (error) {
    if (tempFileUrls.length > 0) {
      await deleteFiles(tempFileUrls).catch(err => {
        logError('Failed to cleanup temp files', err);
      });
    }
    return handleCarError(res, error);
  }
};

export const deleteCar = async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    
    if (!slug || !isValidUUID(slug)) {
      return response.error(res, 'Invalid slug format', 400);
    }
    
    const supabaseUser = getSupabaseUser(req.token);
    await verifyCarExists(supabaseUser, slug, userId);
    await deleteCarBySlugService(supabaseUser, slug, userId);
    
    return response.success(res, null, 'Car deleted successfully');
  } catch (error) {
    return handleCarError(res, error);
  }
};
