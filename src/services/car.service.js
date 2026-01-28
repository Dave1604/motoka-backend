import { buildCarData, buildUpdateData } from '../utils/carDataBuilder.js';
import { extractDuplicateFields, buildDuplicateErrorMessage } from '../utils/carErrorHelpers.js';
import { logError } from '../utils/logger.js';
import { DB_ERROR_CODES, HTTP_STATUS, ERROR_MESSAGES } from '../constants/car.constants.js';

export class CarError extends Error {
  constructor(message, statusCode = HTTP_STATUS.SERVER_ERROR, code = null) {
    super(message);
    this.name = 'CarError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function createCar(supabaseUser, carData) {
  const { data: car, error: insertError } = await supabaseUser
    .from('cars')
    .insert(carData)
    .select()
    .single();
  
  if (insertError) {
    logError('Car insert error', insertError);
    
    if (insertError.code === DB_ERROR_CODES.UNIQUE_VIOLATION) {
      const errorMessage = insertError.message || '';
      const duplicateFields = extractDuplicateFields(
        errorMessage,
        carData.registration_no,
        carData.chasis_no,
        carData.engine_no
      );
      
      throw new CarError(buildDuplicateErrorMessage(duplicateFields), HTTP_STATUS.CONFLICT, DB_ERROR_CODES.UNIQUE_VIOLATION);
    }
    
    if (insertError.code === DB_ERROR_CODES.FOREIGN_KEY_VIOLATION) {
      throw new CarError(ERROR_MESSAGES.INVALID_REQUEST_DATA, HTTP_STATUS.BAD_REQUEST, DB_ERROR_CODES.FOREIGN_KEY_VIOLATION);
    }
    
    if (insertError.code === DB_ERROR_CODES.CHECK_CONSTRAINT_VIOLATION) {
      throw new CarError(ERROR_MESSAGES.INVALID_CAR_DATA, HTTP_STATUS.BAD_REQUEST, DB_ERROR_CODES.CHECK_CONSTRAINT_VIOLATION);
    }
    
    throw new CarError(ERROR_MESSAGES.FAILED_TO_REGISTER, HTTP_STATUS.SERVER_ERROR);
  }
  
  return car;
}

export async function updateCarBySlug(supabaseUser, slug, userId, updateData, identifiers = {}) {
  const { data: updatedCar, error: updateError } = await supabaseUser
    .from('cars')
    .update(updateData)
    .eq('slug', slug)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select()
    .single();
  
  if (updateError) {
    logError('Car update error', updateError);
    
    if (updateError.code === DB_ERROR_CODES.UNIQUE_VIOLATION) {
      const errorMessage = updateError.message || '';
      const duplicateFields = extractDuplicateFields(
        errorMessage,
        identifiers.registration_no,
        identifiers.chasis_no,
        identifiers.engine_no
      );
      
      throw new CarError(buildDuplicateErrorMessage(duplicateFields), HTTP_STATUS.CONFLICT, DB_ERROR_CODES.UNIQUE_VIOLATION);
    }
    
    if (updateError.code === DB_ERROR_CODES.FOREIGN_KEY_VIOLATION) {
      throw new CarError(ERROR_MESSAGES.INVALID_REQUEST_DATA, HTTP_STATUS.BAD_REQUEST, DB_ERROR_CODES.FOREIGN_KEY_VIOLATION);
    }
    
    if (updateError.code === DB_ERROR_CODES.CHECK_CONSTRAINT_VIOLATION) {
      throw new CarError(ERROR_MESSAGES.INVALID_CAR_DATA, HTTP_STATUS.BAD_REQUEST, DB_ERROR_CODES.CHECK_CONSTRAINT_VIOLATION);
    }
    
    throw new CarError(ERROR_MESSAGES.FAILED_TO_UPDATE, HTTP_STATUS.SERVER_ERROR);
  }
  
  if (!updatedCar) {
    throw new CarError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  return updatedCar;
}

export async function getCarBySlug(supabaseUser, slug, userId) {
  const { data: car, error: carError } = await supabaseUser
    .from('cars')
    .select('*')
    .eq('slug', slug)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();
  
  if (carError) {
    if (carError.code === DB_ERROR_CODES.NOT_FOUND) {
      throw new CarError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    
    logError('Get car by slug error', carError);
    throw new CarError(ERROR_MESSAGES.FAILED_TO_RETRIEVE, HTTP_STATUS.SERVER_ERROR);
  }
  
  if (!car) {
    throw new CarError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  return car;
}

export async function getCarsPaginated(supabaseUser, page, limit) {
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  
  /**
   * SCALABILITY: Combine data fetch and count into single query
   * 
   * Before: 2 separate queries (data + count)
   * After: 1 query with count option
   * 
   * Impact: 50% reduction in DB queries for car listings
   * At 1000 list requests/day: saves 1000 DB queries
   */
  const { data: cars, count, error: carsError } = await supabaseUser
    .from('cars')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  
  if (carsError) {
    logError('Get cars error', carsError);
    throw new CarError(ERROR_MESSAGES.FAILED_TO_RETRIEVE_CARS, HTTP_STATUS.SERVER_ERROR);
  }
  
  const totalCars = count || 0;
  const totalPages = Math.ceil(totalCars / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  
  return {
    cars: cars || [],
    pagination: {
      current_page: page,
      limit: limit,
      total_cars: totalCars,
      total_pages: totalPages,
      has_next: hasNext,
      has_prev: hasPrev
    }
  };
}

export async function deleteCarBySlug(supabaseUser, slug, userId) {
  const { data, error: deleteError } = await supabaseUser
    .from('cars')
    .update({ deleted_at: new Date().toISOString() })
    .eq('slug', slug)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select();
  
  if (deleteError) {
    logError('Car delete error', deleteError);
    throw new CarError(ERROR_MESSAGES.FAILED_TO_DELETE, HTTP_STATUS.SERVER_ERROR);
  }
  
  if (!data || data.length === 0) {
    throw new CarError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
}

export async function verifyCarExists(supabaseUser, slug, userId) {
  const { data: existingCar, error: fetchError } = await supabaseUser
    .from('cars')
    .select('*')
    .eq('slug', slug)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();
  
  if (fetchError) {
    if (fetchError.code === DB_ERROR_CODES.NOT_FOUND) {
      throw new CarError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    
    logError('Fetch car error', fetchError);
    throw new CarError(ERROR_MESSAGES.FAILED_TO_RETRIEVE, HTTP_STATUS.SERVER_ERROR);
  }
  
  if (!existingCar) {
    throw new CarError(ERROR_MESSAGES.CAR_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  
  return existingCar;
}
