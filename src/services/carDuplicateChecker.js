import { getSupabaseAdmin } from '../config/supabase.js';
import { buildDuplicateErrorMessage } from '../utils/carErrorHelpers.js';
import { logError } from '../utils/logger.js';

export async function checkCarDuplicates(registrationNo, chasisNo, engineNo, excludeCarId = null) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const duplicateQueries = [];
  
  if (registrationNo) {
    duplicateQueries.push({
      field: 'registration_no',
      value: registrationNo,
      query: buildDuplicateQuery(supabaseAdmin, 'registration_no', registrationNo, excludeCarId)
    });
  }
  
  if (chasisNo) {
    duplicateQueries.push({
      field: 'chasis_no',
      value: chasisNo,
      query: buildDuplicateQuery(supabaseAdmin, 'chasis_no', chasisNo, excludeCarId)
    });
  }
  
  if (engineNo) {
    duplicateQueries.push({
      field: 'engine_no',
      value: engineNo,
      query: buildDuplicateQuery(supabaseAdmin, 'engine_no', engineNo, excludeCarId)
    });
  }
  
  if (duplicateQueries.length === 0) {
    return { hasDuplicates: false };
  }
  
  const results = await Promise.all(duplicateQueries.map(q => q.query));
  
  for (const result of results) {
    if (result.error) {
      logError('Duplicate check error', result.error);
      throw new Error('Failed to validate car registration');
    }
  }
  
  const existingCarsMap = new Map();
  for (const result of results) {
    if (result.data) {
      for (const car of result.data) {
        existingCarsMap.set(car.id, car);
      }
    }
  }
  
  const existingCars = Array.from(existingCarsMap.values());
  
  if (existingCars.length === 0) {
    return { hasDuplicates: false };
  }
  
  const duplicateFields = [];
  for (const car of existingCars) {
    if (registrationNo && car.registration_no === registrationNo) {
      duplicateFields.push('registration number');
    }
    if (chasisNo && car.chasis_no === chasisNo) {
      duplicateFields.push('chassis number');
    }
    if (engineNo && car.engine_no === engineNo) {
      duplicateFields.push('engine number');
    }
  }
  
  const uniqueFields = [...new Set(duplicateFields)];
  
  return {
    hasDuplicates: true,
    message: buildDuplicateErrorMessage(uniqueFields),
    fields: uniqueFields
  };
}

function buildDuplicateQuery(supabase, field, value, excludeCarId) {
  let query = supabase
    .from('cars')
    .select('id, registration_no, chasis_no, engine_no')
    .eq(field, value)
    .is('deleted_at', null);
  
  if (excludeCarId) {
    query = query.neq('id', excludeCarId);
  }
  
  return query;
}
