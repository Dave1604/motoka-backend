/**
 * Location Service
 * 
 * Handles states and LGAs data with database backend and caching.
 * Falls back to constants file if database is unavailable.
 * 
 * Features:
 * - Database queries with in-memory caching
 * - Automatic fallback to constants
 * - Support for state_id/lga_id lookups
 * - Performance optimized with 5-minute cache TTL
 */

import { getSupabaseAdmin } from '../config/supabase.js';
import { 
  getAllStates as getAllStatesFromConstants,
  getLGAsByState as getLGAsByStateFromConstants,
  getDeliveryFee as getDeliveryFeeFromConstants,
  getStateCodeFromInput,
  getLGANameFromInput,
  resolveStateAndLGA as resolveStateAndLGAFromConstants
} from '../constants/states.constants.js';

// In-memory cache (can be replaced with Redis in production)
const cache = {
  states: null,
  lgas: {},
  deliveryFees: {},
  lastUpdated: null,
  TTL: 5 * 60 * 1000 // 5 minutes
};

/**
 * Clear the cache (useful for testing or after updates)
 */
export function clearLocationCache() {
  cache.states = null;
  cache.lgas = {};
  cache.deliveryFees = {};
  cache.lastUpdated = null;
}

/**
 * Check if cache is valid
 */
function isCacheValid() {
  return cache.states && 
         cache.lastUpdated && 
         (Date.now() - cache.lastUpdated) < cache.TTL;
}

/**
 * Get all states from database with caching
 * Falls back to constants if database fails
 * 
 * @returns {Promise<Array>} Array of states with { name, code, delivery_fee }
 */
export async function getAllStates() {
  // Check cache first
  if (isCacheValid()) {
    return cache.states;
  }
  
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('states')
      .select('name, code, delivery_fee')
      .eq('is_active', true)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    
    if (error) {
      throw error;
    }
    
    if (!data || data.length === 0) {
      console.warn('[Location Service] No states found in database, falling back to constants');
      return getAllStatesFromConstants();
    }
    
    // Update cache
    cache.states = data;
    cache.lastUpdated = Date.now();
    
    return data;
  } catch (error) {
    console.error('[Location Service] Database error, falling back to constants:', error.message);
    // Fallback to constants
    return getAllStatesFromConstants();
  }
}

/**
 * Get LGAs for a specific state from database with caching
 * Falls back to constants if database fails
 * 
 * @param {string} stateCode - State code (e.g., "LA")
 * @returns {Promise<Array<string>>} Array of LGA names
 */
export async function getLGAsByState(stateCode) {
  if (!stateCode) {
    return [];
  }
  
  // Check cache first
  if (isCacheValid() && cache.lgas[stateCode]) {
    return cache.lgas[stateCode];
  }
  
  try {
    const supabase = getSupabaseAdmin();
    
    // First get state ID
    const { data: state, error: stateError } = await supabase
      .from('states')
      .select('id')
      .eq('code', stateCode)
      .eq('is_active', true)
      .single();
    
    if (stateError || !state) {
      throw new Error(`State not found: ${stateCode}`);
    }
    
    // Get LGAs for this state
    const { data: lgas, error: lgaError } = await supabase
      .from('local_governments')
      .select('name')
      .eq('state_id', state.id)
      .eq('is_active', true)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    
    if (lgaError) {
      throw lgaError;
    }
    
    const lgaNames = lgas.map(l => l.name);
    
    // Update cache
    cache.lgas[stateCode] = lgaNames;
    cache.lastUpdated = Date.now();
    
    return lgaNames;
  } catch (error) {
    console.error(`[Location Service] Database error for state ${stateCode}, falling back to constants:`, error.message);
    // Fallback to constants
    return getLGAsByStateFromConstants(stateCode);
  }
}

/**
 * Get delivery fee for a state from database with caching
 * Falls back to constants if database fails
 * 
 * @param {string} stateCode - State code (e.g., "LA")
 * @returns {Promise<number>} Delivery fee in kobo
 */
export async function getDeliveryFee(stateCode) {
  if (!stateCode) {
    return 500000; // Default ₦5,000
  }
  
  // Check cache first
  if (isCacheValid() && cache.deliveryFees[stateCode]) {
    return cache.deliveryFees[stateCode];
  }
  
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('states')
      .select('delivery_fee')
      .eq('code', stateCode)
      .eq('is_active', true)
      .single();
    
    if (error || !data) {
      throw new Error(`State not found: ${stateCode}`);
    }
    
    // Update cache
    cache.deliveryFees[stateCode] = data.delivery_fee;
    cache.lastUpdated = Date.now();
    
    return data.delivery_fee;
  } catch (error) {
    console.error(`[Location Service] Database error for delivery fee ${stateCode}, falling back to constants:`, error.message);
    // Fallback to constants
    return getDeliveryFeeFromConstants(stateCode);
  }
}

/**
 * Validate state and LGA
 * Supports both state_id/lga_id (numbers) and state/lga (strings)
 * 
 * @param {number|string} stateInput - State ID or state code
 * @param {number|string} lgaInput - LGA ID or LGA name
 * @returns {Promise<Object>} { valid, stateCode, lgaName, delivery_fee, error }
 */
export async function validateStateAndLGA(stateInput, lgaInput) {
  // First resolve state code (handles both ID and code)
  let stateCode;
  
  if (typeof stateInput === 'number') {
    // It's a state_id - need to look it up
    try {
      const states = await getAllStates();
      if (stateInput >= 0 && stateInput < states.length) {
        stateCode = states[stateInput].code;
      } else {
        return { 
          valid: false, 
          error: 'Invalid state_id' 
        };
      }
    } catch (error) {
      // Fallback to constants resolution
      stateCode = getStateCodeFromInput(stateInput);
    }
  } else {
    // It's already a state code
    stateCode = stateInput;
  }
  
  if (!stateCode) {
    return { 
      valid: false, 
      error: typeof stateInput === 'number' ? 'Invalid state_id' : 'Invalid state code' 
    };
  }
  
  // Get LGAs for this state
  const lgas = await getLGAsByState(stateCode);
  
  // Resolve LGA name
  let lgaName;
  
  if (typeof lgaInput === 'number') {
    // It's an lga_id - use array index
    if (lgaInput >= 0 && lgaInput < lgas.length) {
      lgaName = lgas[lgaInput];
    } else {
      return { 
        valid: false, 
        error: 'Invalid lga_id for selected state' 
      };
    }
  } else {
    // It's already an LGA name
    lgaName = lgaInput;
  }
  
  // Validate LGA belongs to state
  if (!lgas.includes(lgaName)) {
    return { 
      valid: false, 
      error: 'Invalid local government for selected state' 
    };
  }
  
  // Get delivery fee
  const deliveryFee = await getDeliveryFee(stateCode);
  
  return {
    valid: true,
    stateCode,
    lgaName,
    delivery_fee: deliveryFee
  };
}

/**
 * Resolve state and LGA from IDs or codes/names
 * This is the main function used by payment controller
 * 
 * @param {number|string} stateInput - State ID or state code
 * @param {number|string} lgaInput - LGA ID or LGA name
 * @returns {Promise<Object>} { valid, stateCode, lgaName, delivery_fee, error }
 */
export async function resolveStateAndLGA(stateInput, lgaInput) {
  return validateStateAndLGA(stateInput, lgaInput);
}
