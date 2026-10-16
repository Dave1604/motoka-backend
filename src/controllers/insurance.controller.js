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

// Curacel will not quote without the driver's licence number and a copy of
// the document, plus the holder's date of birth. All three live on the
// licence application the user already filed with us.
async function loadCurrentLicence(userId) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('driver_license_applications')
    .select('license_number, license_document_url, date_of_birth')
    .eq('user_id', userId)
    .not('license_number', 'is', null)
    .not('license_document_url', 'is', null)
    .order('is_current', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

const VEHICLE_FIELDS = {
  registrationNumber: ['plate_number', 'registration_no'],
  make: ['vehicle_make'],
  model: ['vehicle_model'],
  year: ['vehicle_year'],
  color: ['vehicle_color'],
  chassisNumber: ['chasis_no'],
  engineNumber: ['engine_no']
};

function vehicleFromCar(car) {
  const vehicle = {};
  const missing = [];
  for (const [key, columns] of Object.entries(VEHICLE_FIELDS)) {
    const value = columns.map((c) => car[c]).find((v) => v != null && v !== '');
    if (value == null) missing.push(columns[0]);
    else vehicle[key] = key === 'year' ? Number(value) : value;
  }
  return { vehicle, missing };
}

// POST /api/insurance/quote
export const getQuote = async (req, res) => {
  try {
    const { car_id: carId, cover_types: coverTypes, vehicle_value: vehicleValue } = req.body;
    const profile = req.user.profile || {};

    const car = await loadOwnedCar(carId, req.user.id);
    if (!car) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    const { vehicle, missing } = vehicleFromCar(car);
    if (missing.length) {
      return res.status(422).json({
        success: false,
        message: INSURANCE_ERROR_MESSAGES.VEHICLE_INCOMPLETE,
        missing
      });
    }

    const licence = await loadCurrentLicence(req.user.id);
    if (!licence) {
      return res.status(422).json({ success: false, message: INSURANCE_ERROR_MESSAGES.LICENCE_REQUIRED });
    }
    if (!profile.address) {
      return res.status(422).json({ success: false, message: INSURANCE_ERROR_MESSAGES.PROFILE_INCOMPLETE });
    }

    const { quotes, failures } = await quoteVehicle({
      customer: {
        ref: req.user.id,
        email: req.user.email,
        firstName: profile.first_name || 'Motoka',
        lastName: profile.last_name || 'Customer',
        phone: profile.phone_number,
        birthDate: licence.date_of_birth,
        address: profile.address
      },
      vehicle: { ...vehicle, value: Number(vehicleValue) || null, assetRef: `motoka-car-${car.id}` },
      licence: { number: licence.license_number, documentUrl: licence.license_document_url },
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
      coverType
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
