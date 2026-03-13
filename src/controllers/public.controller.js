/**
 * PUBLIC CONTROLLER
 *
 * Exposes read-only reference data (renewal items, states, LGAs) with no
 * authentication required. All handlers delegate to the same service
 * functions used by the authenticated payment endpoints.
 */

import { getRenewalItems } from '../services/payment/renewalItems.service.js';
import { getAllStates, getLGAsByState } from '../services/location.service.js';
import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';

/**
 * GET /api/public/renewal-items
 * Returns all active renewal document types with their prices.
 * Replaces HARDCODED_DOCS and HARDCODED_AMOUNT_PER_DOC in RenewModal.
 */
export const listRenewalItems = async (req, res) => {
  try {
    const items = await getRenewalItems();
    return response.success(res, items, 'Renewal items retrieved');
  } catch (error) {
    logError('[Public] listRenewalItems error', error);
    return response.serverError(res, 'Failed to retrieve renewal items');
  }
};

/**
 * GET /api/public/states
 * Returns all active states with per-state delivery fees.
 * Replaces HARDCODED_STATES and the flat HARDCODED_DELIVERY_FEE in RenewModal.
 */
export const listStates = async (req, res) => {
  try {
    const states = await getAllStates();
    return response.success(res, states, 'States retrieved');
  } catch (error) {
    logError('[Public] listStates error', error);
    return response.serverError(res, 'Failed to retrieve states');
  }
};

/**
 * GET /api/public/states/:stateCode/lgas
 * Returns LGA names for the given state code.
 * Replaces HARDCODED_LGAS in RenewModal.
 */
export const listLGAs = async (req, res) => {
  try {
    const { stateCode } = req.params;
    if (!stateCode) {
      return response.error(res, 'stateCode is required', 400);
    }
    const lgas = await getLGAsByState(stateCode.toUpperCase());
    if (!lgas || lgas.length === 0) {
      return response.notFound(res, 'No local governments found for the given state');
    }
    return response.success(res, lgas, 'Local governments retrieved');
  } catch (error) {
    logError('[Public] listLGAs error', error);
    return response.serverError(res, 'Failed to retrieve local governments');
  }
};
