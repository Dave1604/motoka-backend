/**
 * Car module constants
 * Centralized configuration for car-related operations
 */

// Pagination limits
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MIN_PAGE: 1,
  MAX_PAGE: 100000,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100
};

// Field length limits
export const FIELD_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 100,
  ADDRESS_MIN: 5,
  ADDRESS_MAX: 500,
  VEHICLE_MAKE_MIN: 1,
  VEHICLE_MAKE_MAX: 50,
  VEHICLE_MODEL_MIN: 1,
  VEHICLE_MODEL_MAX: 50,
  VEHICLE_COLOR_MIN: 2,
  VEHICLE_COLOR_MAX: 30,
  VEHICLE_YEAR_MIN: 1900,
  VEHICLE_YEAR_MAX_OFFSET: 1, // Current year + 1
  REGISTRATION_NO_MIN: 1,
  REGISTRATION_NO_MAX: 20,
  CHASIS_NO_MIN: 1,
  CHASIS_NO_MAX: 30,
  ENGINE_NO_MIN: 1,
  ENGINE_NO_MAX: 30,
  PLATE_NUMBER_MIN: 1,
  PLATE_NUMBER_MAX: 20,
  PREFERRED_NAME_MIN: 1,
  PREFERRED_NAME_MAX: 100,
  BUSINESS_TYPE_MIN: 1,
  BUSINESS_TYPE_MAX: 50,
  COMPANY_NAME_MIN: 1,
  COMPANY_NAME_MAX: 100,
  COMPANY_ADDRESS_MIN: 5,
  COMPANY_ADDRESS_MAX: 500,
  CAC_NUMBER_MIN: 1,
  CAC_NUMBER_MAX: 50,
  DOCUMENT_IMAGES_MAX: 10,
  URL_MAX_LENGTH: 2048
};

// Database error codes
export const DB_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_CONSTRAINT_VIOLATION: '23514',
  NOT_FOUND: 'PGRST116'
};

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  SERVER_ERROR: 500
};

// Car type enums
export const CAR_TYPES = {
  PRIVATE: 'private',
  COMMERCIAL: 'commercial'
};

// Registration status enums
export const REGISTRATION_STATUS = {
  REGISTERED: 'registered',
  UNREGISTERED: 'unregistered'
};

// Plate types
export const PLATE_TYPES = {
  NORMAL: 'Normal',
  CUSTOMIZED: 'Customized',
  DEALERSHIP: 'Dealership'
};

// Error messages
export const ERROR_MESSAGES = {
  INVALID_SLUG: 'Invalid slug format',
  INVALID_PAGE: 'Invalid page parameter. Must be a positive integer.',
  INVALID_LIMIT: 'Invalid limit parameter. Must be a positive integer.',
  PAGE_OUT_OF_RANGE: `Page parameter must be between ${PAGINATION.MIN_PAGE} and ${PAGINATION.MAX_PAGE}.`,
  LIMIT_OUT_OF_RANGE: `Limit parameter must be between ${PAGINATION.MIN_LIMIT} and ${PAGINATION.MAX_LIMIT}.`,
  CAR_NOT_FOUND: 'Car not found or access denied',
  INVALID_REQUEST_DATA: 'Invalid request data',
  INVALID_CAR_DATA: 'Invalid car registration data provided',
  FAILED_TO_REGISTER: 'Failed to register car',
  FAILED_TO_UPDATE: 'Failed to update car',
  FAILED_TO_DELETE: 'Failed to delete car',
  FAILED_TO_RETRIEVE: 'Failed to retrieve car',
  FAILED_TO_RETRIEVE_CARS: 'Failed to retrieve cars',
  FAILED_TO_RETRIEVE_COUNT: 'Failed to retrieve cars count'
};

// Regex patterns
export const PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  POSITIVE_INTEGER: /^\d+$/
};

// File upload field configurations
export const FILE_UPLOAD_FIELDS = [
  { key: 'document_images', isArray: true },
  { key: 'cac_document', isArray: false },
  { key: 'letterhead', isArray: false },
  { key: 'means_of_identification', isArray: false }
];
