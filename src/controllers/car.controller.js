import { getSupabaseUser, getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import { sanitizeCarInput } from '../utils/carSanitization.js';
import { checkCarDuplicates } from '../services/carDuplicateChecker.js';
import { buildCarData, buildUpdateData, extractNormalizedIdentifiers } from '../utils/carDataBuilder.js';
import { validateConditionalFields } from '../utils/carUpdateValidator.js';
import { buildExpiryStatus } from '../utils/expiryStatus.js';
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
import { createInAppNotification } from '../services/notification.service.js';
import { sendWelcomeEmail } from '../services/email/carEmail.service.js';
import { PAGINATION, PATTERNS, ERROR_MESSAGES, HTTP_STATUS } from '../constants/car.constants.js';

/**
 * Get pending orders for cars
 * @param {number[]} carIds - Array of car IDs
 * @returns {Promise<Map<number, Object>>} Map of carId to pending order
 */
const getPendingOrdersForCars = async (carIds) => {
  if (!carIds || carIds.length === 0) return new Map();
  
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: orders, error } = await supabaseAdmin
      .from('renewal_orders')
      .select('id, order_number, car_id, status, created_at')
      .in('car_id', carIds)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });
    
    if (error) {
      logError('Failed to fetch pending orders', error);
      return new Map();
    }
    
    // Create map of carId -> most recent pending order
    const orderMap = new Map();
    for (const order of orders || []) {
      if (!orderMap.has(order.car_id)) {
        orderMap.set(order.car_id, order);
      }
    }
    return orderMap;
  } catch (err) {
    logError('Error fetching pending orders', err);
    return new Map();
  }
};

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
    
    // Check if this is the user's first car (all non-deleted cars)
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { count } = await supabaseAdmin
        .from('cars')
        .select('id', { count: 'exact' })
        .eq('user_id', userId)
        .is('deleted_at', null);
      
      const isFirstCar = count === 1;
      
      if (isFirstCar) {
        // Fetch user profile for email and name
        const { data: userProfile } = await supabaseAdmin
          .from('profiles')
          .select('email, first_name')
          .eq('id', userId)
          .single();
        
        const userEmail = userProfile?.email || supabaseUser.user?.email;
        const firstName = userProfile?.first_name || null;
        
        // Create in-app notification (always succeeds independently)
        try {
          await createInAppNotification(
            userId,
            'welcome',
            'first_car_registered',
            'Welcome to Motoka 🎉 Thanks for registering your first car with us!'
          );
          console.log('[Car Controller] Welcome in-app notification created for user:', userId);
        } catch (notifError) {
          logError('Failed to create welcome in-app notification', notifError);
          // Continue - in-app notification failure doesn't block the response
        }
        
        // Send welcome email with retry logic (independent process)
        try {
          await sendWelcomeEmail({
            to: userEmail,
            firstName,
            carDetails: {
              make: car.vehicle_make,
              model: car.vehicle_model,
              registration_no: car.registration_no
            }
          });
          console.log('[Car Controller] Welcome email sent to user:', userId);
        } catch (emailError) {
          logError('Failed to send welcome email', emailError);
          // Log error but don't block response - this is a best-effort operation
          // In production, this might trigger a retry queue or alerting system
        }
      }
    } catch (notificationError) {
      logError('Error processing welcome notifications', notificationError);
      // Non-blocking error for notifications - don't interrupt car creation response
    }
    
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
    
    // Fetch pending orders for all cars
    const carIds = (result.cars || []).map(car => car.id);
    const pendingOrdersMap = await getPendingOrdersForCars(carIds);
    
    const carsWithReminder = (result.cars || []).map((car) => ({
      ...car,
      reminder: buildExpiryStatus(car.expiry_date, new Date(), pendingOrdersMap.get(car.id) || null)
    }));
    
    return response.success(res, { ...result, cars: carsWithReminder }, 'Cars retrieved successfully');
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
    
    // Check for pending order
    const pendingOrdersMap = await getPendingOrdersForCars([car.id]);
    const pendingOrder = pendingOrdersMap.get(car.id) || null;
    
    const carWithReminder = {
      ...car,
      reminder: buildExpiryStatus(car.expiry_date, new Date(), pendingOrder)
    };
    
    return response.success(res, { car: carWithReminder }, 'Car retrieved successfully');
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
