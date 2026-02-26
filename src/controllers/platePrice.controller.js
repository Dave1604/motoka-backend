import * as response from '../utils/responses.js';
import { logError } from '../utils/logger.js';
import { getPlateNumberPrices } from '../services/platePrice.service.js';
import { HTTP_STATUS } from '../constants/car.constants.js';

/**
 * GET /api/plate-number-prices
 * Returns all active plate-number pricing rows.
 * Public to authenticated users – no special role required.
 */
export const listPlateNumberPrices = async (req, res) => {
  try {
    const prices = await getPlateNumberPrices();
    return response.success(res, { prices }, 'Plate number prices retrieved successfully');
  } catch (error) {
    logError('Failed to retrieve plate number prices', error);
    return response.serverError(res, 'Failed to retrieve plate number prices');
  }
};
