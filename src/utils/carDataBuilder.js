import { randomUUID } from 'crypto';
import { sanitizeString, normalizeOptional } from './carSanitization.js';

export function buildCarData(sanitizedBody, userId) {
  const {
    name_of_owner,
    phone_number,
    address,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    car_type,
    registration_status,
    registration_no,
    chasis_no,
    engine_no,
    date_issued,
    expiry_date,
    document_images,
    plate_number,
    type,
    preferred_name,
    business_type,
    cac_document,
    letterhead,
    means_of_identification,
    company_name,
    company_address,
    company_phone,
    cac_number
  } = sanitizedBody;
  
  const parsedYear = parseInt(vehicle_year, 10);
  if (isNaN(parsedYear)) {
    throw new Error('Invalid vehicle year provided');
  }
  
  const normalizedRegistrationNo = normalizeOptional(registration_no);
  const normalizedChasisNo = normalizeOptional(chasis_no);
  const normalizedEngineNo = normalizeOptional(engine_no);
  
  const slug = randomUUID();
  
  return {
    slug,
    user_id: userId,
    name_of_owner: sanitizeString(name_of_owner),
    phone_number: normalizeOptional(phone_number),
    address: sanitizeString(address, true),
    vehicle_make: sanitizeString(vehicle_make),
    vehicle_model: sanitizeString(vehicle_model),
    vehicle_year: parsedYear,
    vehicle_color: sanitizeString(vehicle_color),
    car_type,
    registration_status,
    status: 'unpaid',
    registration_no: normalizedRegistrationNo,
    chasis_no: normalizedChasisNo,
    engine_no: normalizedEngineNo,
    date_issued: normalizeOptional(date_issued),
    expiry_date: normalizeOptional(expiry_date),
    document_images: Array.isArray(document_images) 
      ? document_images
          .filter(url => url && typeof url === 'string' && url.trim().length > 0)
          .map(url => url.trim())
          .slice(0, 10)
      : [],
    plate_number: normalizeOptional(plate_number),
    type: normalizeOptional(type),
    preferred_name: normalizeOptional(preferred_name),
    business_type: normalizeOptional(business_type),
    cac_document: normalizeOptional(cac_document),
    letterhead: normalizeOptional(letterhead),
    means_of_identification: normalizeOptional(means_of_identification),
    company_name: normalizeOptional(company_name),
    company_address: normalizeOptional(company_address),
    company_phone: normalizeOptional(company_phone),
    cac_number: normalizeOptional(cac_number)
  };
}

export function buildUpdateData(sanitizedBody, existingCar) {
  const {
    name_of_owner,
    phone_number,
    address,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    car_type,
    registration_status,
    registration_no,
    chasis_no,
    engine_no,
    date_issued,
    expiry_date,
    document_images,
    plate_number,
    type,
    preferred_name,
    business_type,
    cac_document,
    letterhead,
    means_of_identification,
    company_name,
    company_address,
    company_phone,
    cac_number
  } = sanitizedBody;
  
  const updateData = {};
  
  if (name_of_owner !== undefined) {
    updateData.name_of_owner = sanitizeString(name_of_owner);
  }
  if (phone_number !== undefined) {
    updateData.phone_number = normalizeOptional(phone_number);
  }
  if (address !== undefined) {
    updateData.address = sanitizeString(address, true);
  }
  if (vehicle_make !== undefined) {
    updateData.vehicle_make = sanitizeString(vehicle_make);
  }
  if (vehicle_model !== undefined) {
    updateData.vehicle_model = sanitizeString(vehicle_model);
  }
  if (vehicle_year !== undefined) {
    const parsedYear = parseInt(vehicle_year, 10);
    if (isNaN(parsedYear)) {
      throw new Error('Invalid vehicle year provided');
    }
    updateData.vehicle_year = parsedYear;
  }
  if (vehicle_color !== undefined) {
    updateData.vehicle_color = sanitizeString(vehicle_color);
  }
  if (car_type !== undefined) {
    updateData.car_type = car_type;
  }
  if (registration_status !== undefined) {
    updateData.registration_status = registration_status;
  }
  if (registration_no !== undefined) {
    updateData.registration_no = normalizeOptional(registration_no);
  }
  if (chasis_no !== undefined) {
    updateData.chasis_no = normalizeOptional(chasis_no);
  }
  if (engine_no !== undefined) {
    updateData.engine_no = normalizeOptional(engine_no);
  }
  if (date_issued !== undefined) {
    updateData.date_issued = normalizeOptional(date_issued);
  }
  if (expiry_date !== undefined) {
    updateData.expiry_date = normalizeOptional(expiry_date);
  }
  if (document_images !== undefined) {
    updateData.document_images = Array.isArray(document_images) 
      ? document_images
          .filter(url => url && typeof url === 'string' && url.trim().length > 0)
          .map(url => url.trim())
          .slice(0, 10)
      : [];
  }
  if (plate_number !== undefined) {
    updateData.plate_number = normalizeOptional(plate_number);
  }
  if (type !== undefined) {
    updateData.type = normalizeOptional(type);
  }
  if (preferred_name !== undefined) {
    updateData.preferred_name = normalizeOptional(preferred_name);
  }
  if (business_type !== undefined) {
    updateData.business_type = normalizeOptional(business_type);
  }
  if (cac_document !== undefined) {
    updateData.cac_document = normalizeOptional(cac_document);
  }
  if (letterhead !== undefined) {
    updateData.letterhead = normalizeOptional(letterhead);
  }
  if (means_of_identification !== undefined) {
    updateData.means_of_identification = normalizeOptional(means_of_identification);
  }
  if (company_name !== undefined) {
    updateData.company_name = normalizeOptional(company_name);
  }
  if (company_address !== undefined) {
    updateData.company_address = normalizeOptional(company_address);
  }
  if (company_phone !== undefined) {
    updateData.company_phone = normalizeOptional(company_phone);
  }
  if (cac_number !== undefined) {
    updateData.cac_number = normalizeOptional(cac_number);
  }
  
  return updateData;
}

export function extractNormalizedIdentifiers(sanitizedBody, existingCar = null) {
  const { registration_no, chasis_no, engine_no } = sanitizedBody;
  
  if (existingCar) {
    return {
      registration_no: registration_no !== undefined ? normalizeOptional(registration_no) : existingCar.registration_no,
      chasis_no: chasis_no !== undefined ? normalizeOptional(chasis_no) : existingCar.chasis_no,
      engine_no: engine_no !== undefined ? normalizeOptional(engine_no) : existingCar.engine_no
    };
  } else {
    return {
      registration_no: normalizeOptional(registration_no),
      chasis_no: normalizeOptional(chasis_no),
      engine_no: normalizeOptional(engine_no)
    };
  }
}
