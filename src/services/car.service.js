import { buildCarData, buildUpdateData } from '../utils/carDataBuilder.js';
import { extractDuplicateFields, buildDuplicateErrorMessage } from '../utils/carErrorHelpers.js';
import { logError } from '../utils/logger.js';

export class CarError extends Error {
  constructor(message, statusCode = 500, code = null) {
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
    
    if (insertError.code === '23505') {
      const errorMessage = insertError.message || '';
      const duplicateFields = extractDuplicateFields(
        errorMessage,
        carData.registration_no,
        carData.chasis_no,
        carData.engine_no
      );
      
      throw new CarError(buildDuplicateErrorMessage(duplicateFields), 409, '23505');
    }
    
    if (insertError.code === '23503') {
      throw new CarError('Invalid request data', 400, '23503');
    }
    
    if (insertError.code === '23514') {
      throw new CarError('Invalid car registration data provided', 400, '23514');
    }
    
    throw new CarError('Failed to register car', 500);
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
    
    if (updateError.code === '23505') {
      const errorMessage = updateError.message || '';
      const duplicateFields = extractDuplicateFields(
        errorMessage,
        identifiers.registration_no,
        identifiers.chasis_no,
        identifiers.engine_no
      );
      
      throw new CarError(buildDuplicateErrorMessage(duplicateFields), 409, '23505');
    }
    
    if (updateError.code === '23503') {
      throw new CarError('Invalid request data', 400, '23503');
    }
    
    if (updateError.code === '23514') {
      throw new CarError('Invalid car registration data provided', 400, '23514');
    }
    
    throw new CarError('Failed to update car', 500);
  }
  
  if (!updatedCar) {
    throw new CarError('Car not found or access denied', 404);
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
    if (carError.code === 'PGRST116') {
      throw new CarError('Car not found or access denied', 404);
    }
    
    logError('Get car by slug error', carError);
    throw new CarError('Failed to retrieve car', 500);
  }
  
  if (!car) {
    throw new CarError('Car not found or access denied', 404);
  }
  
  return car;
}

export async function getCarsPaginated(supabaseUser, page, limit) {
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  
  const { data: cars, error: carsError } = await supabaseUser
    .from('cars')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  
  if (carsError) {
    logError('Get cars error', carsError);
    throw new CarError('Failed to retrieve cars', 500);
  }
  
  const { count, error: countError } = await supabaseUser
    .from('cars')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);
  
  if (countError) {
    logError('Get cars count error', countError);
    throw new CarError('Failed to retrieve cars count', 500);
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
    throw new CarError('Failed to delete car', 500);
  }
  
  if (!data || data.length === 0) {
    throw new CarError('Car not found or access denied', 404);
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
    if (fetchError.code === 'PGRST116') {
      throw new CarError('Car not found or access denied', 404);
    }
    
    logError('Fetch car error', fetchError);
    throw new CarError('Failed to retrieve car', 500);
  }
  
  if (!existingCar) {
    throw new CarError('Car not found or access denied', 404);
  }
  
  return existingCar;
}
