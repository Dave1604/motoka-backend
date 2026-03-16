import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import { getDriverLicensePrices } from '../services/driverLicensePrice.service.js';

/**
 * GET /api/driver-license-prices
 * Returns all active driver license pricing rows (new / renew).
 */
export const listDriverLicensePrices = async (req, res) => {
  try {
    const prices = await getDriverLicensePrices();
    return response.success(res, { prices }, 'Driver license prices retrieved successfully');
  } catch (error) {
    logError('Failed to retrieve driver license prices', error);
    return response.serverError(res, 'Failed to retrieve driver license prices');
  }
};
   