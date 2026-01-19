// Removes control characters and normalizes whitespace
export const sanitizeStringValue = (value, preserveNewlines = false) => {
  if (value === null || value === undefined) {
    return preserveNewlines ? '' : null;
  }
  if (typeof value !== 'string') {
    value = String(value);
  }
  let sanitized = value.trim().replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  
  if (preserveNewlines) {
    sanitized = sanitized.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    sanitized = sanitized.replace(/\s+/g, ' ');
  }
  return sanitized || (preserveNewlines ? '' : null);
};

export const normalizeOptional = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    return sanitizeStringValue(value, false);
  }
  if (Array.isArray(value)) {
    return value.filter(item => item !== null && item !== undefined && item !== '');
  }
  return value;
};

export const sanitizeString = (value, preserveNewlines = false) => {
  return sanitizeStringValue(value, preserveNewlines) || '';
};

// Whitelist approach - only allows specific fields
export const sanitizeCarInput = (body) => {
  const allowedFields = [
    'name_of_owner',
    'address',
    'phone_number',
    'vehicle_make',
    'vehicle_model',
    'vehicle_year',
    'vehicle_color',
    'car_type',
    'registration_status',
    'registration_no',
    'chasis_no',
    'engine_no',
    'date_issued',
    'expiry_date',
    'document_images',
    'plate_number',
    'type',
    'preferred_name',
    'business_type',
    'cac_document',
    'letterhead',
    'means_of_identification',
    'company_name',
    'company_address',
    'company_phone',
    'cac_number'
  ];

  const sanitized = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      sanitized[field] = body[field];
    }
  }

  return sanitized;
};
