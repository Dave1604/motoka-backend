import {
  quoteVehicle,
  purchasePolicy,
  getPolicyForCar,
  InsuranceError
} from '../services/insurance/insurance.service.js';
import { CuracelError } from '../services/insurance/curacel.service.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { logError } from '../utils/logger.js';
import { INSURANCE_ERROR_MESSAGES } from '../constants/insurance.constants.js';

function fail(res, err, fallbackMessage) {
  const status =
    err instanceof InsuranceError || err instanceof CuracelError ? err.statusCode : 500;

  // Provider errors are logged in full but never echoed verbatim to the
  // client — upstream messages can carry account or product detail.
  logError('Insurance request failed', { error: err.message, code: err.code });

  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallbackMessage : err.message
  });
}

// Confirms the car belongs to the caller before anything provider-facing
// happens. Quoting leaks vehicle details, so this guards the read path too,
// not just purchase.
async function loadOwnedCar(carId, userId) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('cars')
    .select('*')
    .eq('id', carId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

// POST /api/insurance/quote
export const getQuote = async (req, res) => {
  try {
    const { car_id: carId, cover_types: coverTypes } = req.body;

    const car = await loadOwnedCar(carId, req.user.id);
    if (!car) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    const { quotes, failures } = await quoteVehicle({
      vehicle: {
        registrationNumber: car.plate_number,
        make: car.vehicle_make,
        model: car.vehicle_model,
        year: car.vehicle_year,
        value: car.vehicle_value
      },
      coverTypes
    });

    return res.status(200).json({ success: true, data: { quotes, failures } });
  } catch (err) {
    return fail(res, err, INSURANCE_ERROR_MESSAGES.QUOTE_FAILED);
  }
};

// POST /api/insurance/purchase
export const purchase = async (req, res) => {
  try {
    const { car_id: carId, quotation_id: quotationId, cover_type: coverType } = req.body;

    const car = await loadOwnedCar(carId, req.user.id);
    if (!car) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    const policy = await purchasePolicy({
      userId: req.user.id,
      carId,
      quotationId,
      coverType,
      customer: {
        email: req.user.email,
        firstName: req.user.first_name ?? req.user.name ?? 'Motoka',
        lastName: req.user.last_name ?? 'Customer',
        phone: req.user.phone
      }
    });

    return res.status(201).json({ success: true, data: policy });
  } catch (err) {
    return fail(res, err, INSURANCE_ERROR_MESSAGES.PURCHASE_FAILED);
  }
};

// GET /api/insurance/policy/:carId
export const getPolicy = async (req, res) => {
  try {
    const policy = await getPolicyForCar(req.params.carId, req.user.id);
    if (!policy) {
      return res
        .status(404)
        .json({ success: false, message: INSURANCE_ERROR_MESSAGES.POLICY_NOT_FOUND });
    }
    return res.status(200).json({ success: true, data: policy });
  } catch (err) {
    return fail(res, err, INSURANCE_ERROR_MESSAGES.POLICY_NOT_FOUND);
  }
};
