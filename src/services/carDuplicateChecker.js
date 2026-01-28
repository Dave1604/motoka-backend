import { getSupabaseAdmin } from '../config/supabase.js';
import { buildDuplicateErrorMessage } from '../utils/carErrorHelpers.js';
import { logError } from '../utils/logger.js';

/**
 * SCALABILITY: DEPRECATED - Remove redundant duplicate checking
 * 
 * Previous approach (inefficient):
 * 1. App makes 3 parallel queries to check for duplicates
 * 2. If no duplicates, app attempts INSERT
 * 3. Database checks unique constraints (again)
 * 4. INSERT succeeds
 * 
 * Total: 4 operations (3 SELECTs + 1 INSERT with constraint check)
 * 
 * New approach (efficient):
 * 1. App attempts INSERT directly
 * 2. Database checks unique constraints
 * 3. If constraint violated, database returns error (code 23505)
 * 4. App catches error and returns user-friendly message
 * 
 * Total: 1 operation (INSERT with constraint check)
 * 
 * Benefits:
 * - 75% reduction in DB queries for car registration
 * - Eliminates race condition (TOCTOU - Time Of Check Time Of Use)
 * - Database constraint is single source of truth
 * - Simpler code, fewer bugs
 * 
 * Migration note:
 * - car.service.js already handles DB_ERROR_CODES.UNIQUE_VIOLATION
 * - This function is kept for backward compatibility only
 * - Remove calls to checkCarDuplicates() from controllers
 * - Delete this file after confirming all controllers updated
 * 
 * Database constraints (already in place):
 * - cars.registration_no: UNIQUE constraint
 * - cars.chasis_no: UNIQUE constraint
 * - cars.engine_no: UNIQUE constraint
 */

/**
 * @deprecated Use database constraints instead
 * Kept for backward compatibility only - will be removed
 */
export async function checkCarDuplicates(registrationNo, chasisNo, engineNo, excludeCarId = null) {
  console.warn('[DEPRECATED] checkCarDuplicates called - migrate to constraint-based approach');
  
  // Return no duplicates to allow INSERT to proceed
  // Database will enforce constraints and throw proper error if needed
  return { hasDuplicates: false };
  
  /* REMOVED: Redundant pre-check queries
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
  
  ... (rest of duplicate checking logic removed)
  */
}

/**
 * @deprecated Helper function no longer needed
 */
function buildDuplicateQuery(supabase, field, value, excludeCarId) {
  // Kept for reference only - not executed
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
