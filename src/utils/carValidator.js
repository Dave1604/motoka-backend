import { body } from 'express-validator';
import { FIELD_LIMITS, REGISTRATION_STATUS, PLATE_TYPES, CAR_TYPES } from '../constants/car.constants.js';

// Prevents javascript: and data: URL injection attacks
const isHttpUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  if (value.length > FIELD_LIMITS.URL_MAX_LENGTH) {
    return false;
  }
  
  try {
    const url = new URL(value);
    
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    
    const lowerValue = value.toLowerCase().trim();
    if (lowerValue.startsWith('javascript:') || lowerValue.startsWith('data:')) {
      return false;
    }
    
    if (!url.hostname || url.hostname.length === 0) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
};

const currentYear = new Date().getFullYear();

// Shared validation functions
const createDateIssuedValidator = () => {
  return body('date_issued')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.registration_status === REGISTRATION_STATUS.REGISTERED) {
        if (!value || value === 'null' || value === '') {
          throw new Error('Date issued is required for registered cars');
        }
      }
      return true;
    })
    .isISO8601().withMessage('Date issued must be a valid date');
};

const createExpiryDateValidator = () => {
  return body('expiry_date')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.registration_status === REGISTRATION_STATUS.REGISTERED) {
        if (!value || value === 'null' || value === '') {
          throw new Error('Expiry date is required for registered cars');
        }
        if (req.body.date_issued && new Date(value) <= new Date(req.body.date_issued)) {
          throw new Error('Expiry date must be after date issued');
        }
      }
      return true;
    })
    .isISO8601().withMessage('Expiry date must be a valid date');
};

const createDealershipFieldValidator = (fieldName, errorMessage, additionalValidation = null) => {
  let validator = body(fieldName)
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === PLATE_TYPES.DEALERSHIP) {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error(errorMessage);
        }
      }
      return true;
    })
    .trim();
  
  if (additionalValidation) {
    validator = additionalValidation(validator);
  }
  
  return validator;
};

export const addCarValidation = [
  body('name_of_owner')
    .trim()
    .notEmpty().withMessage('Name of owner is required')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX }).withMessage(`Name of owner must be ${FIELD_LIMITS.NAME_MIN}-${FIELD_LIMITS.NAME_MAX} characters`),
  body('address')
    .trim()
    .notEmpty().withMessage('Address is required')
    .isLength({ min: FIELD_LIMITS.ADDRESS_MIN, max: FIELD_LIMITS.ADDRESS_MAX }).withMessage(`Address must be ${FIELD_LIMITS.ADDRESS_MIN}-${FIELD_LIMITS.ADDRESS_MAX} characters`),
  body('phone_number')
    .optional({ values: 'null' })
    .trim()
    .isMobilePhone('any').withMessage('Invalid phone number'),
  
  body('vehicle_make')
    .trim()
    .notEmpty().withMessage('Vehicle make is required')
    .isLength({ min: FIELD_LIMITS.VEHICLE_MAKE_MIN, max: FIELD_LIMITS.VEHICLE_MAKE_MAX }).withMessage(`Vehicle make must be ${FIELD_LIMITS.VEHICLE_MAKE_MIN}-${FIELD_LIMITS.VEHICLE_MAKE_MAX} characters`),
  body('vehicle_model')
    .trim()
    .notEmpty().withMessage('Vehicle model is required')
    .isLength({ min: FIELD_LIMITS.VEHICLE_MODEL_MIN, max: FIELD_LIMITS.VEHICLE_MODEL_MAX }).withMessage(`Vehicle model must be ${FIELD_LIMITS.VEHICLE_MODEL_MIN}-${FIELD_LIMITS.VEHICLE_MODEL_MAX} characters`),
  body('vehicle_year')
    .notEmpty().withMessage('Vehicle year is required')
    .isInt({ min: FIELD_LIMITS.VEHICLE_YEAR_MIN, max: currentYear + FIELD_LIMITS.VEHICLE_YEAR_MAX_OFFSET }).withMessage(`Vehicle year must be between ${FIELD_LIMITS.VEHICLE_YEAR_MIN} and ${currentYear + FIELD_LIMITS.VEHICLE_YEAR_MAX_OFFSET}`),
  body('vehicle_color')
    .trim()
    .notEmpty().withMessage('Vehicle color is required')
    .isLength({ min: FIELD_LIMITS.VEHICLE_COLOR_MIN, max: FIELD_LIMITS.VEHICLE_COLOR_MAX }).withMessage(`Vehicle color must be ${FIELD_LIMITS.VEHICLE_COLOR_MIN}-${FIELD_LIMITS.VEHICLE_COLOR_MAX} characters`),
  body('car_type')
    .trim()
    .notEmpty().withMessage('Car type is required')
    .isIn([CAR_TYPES.PRIVATE, CAR_TYPES.COMMERCIAL]).withMessage('Car type must be either private or commercial'),
  body('registration_status')
    .trim()
    .notEmpty().withMessage('Registration status is required')
    .isIn([REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.UNREGISTERED]).withMessage('Registration status must be either registered or unregistered'),
  
  body('registration_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.REGISTRATION_NO_MIN, max: FIELD_LIMITS.REGISTRATION_NO_MAX }).withMessage(`Registration number must be ${FIELD_LIMITS.REGISTRATION_NO_MIN}-${FIELD_LIMITS.REGISTRATION_NO_MAX} characters`),
  body('chasis_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.CHASIS_NO_MIN, max: FIELD_LIMITS.CHASIS_NO_MAX }).withMessage(`Chasis number must be ${FIELD_LIMITS.CHASIS_NO_MIN}-${FIELD_LIMITS.CHASIS_NO_MAX} characters`),
  body('engine_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.ENGINE_NO_MIN, max: FIELD_LIMITS.ENGINE_NO_MAX }).withMessage(`Engine number must be ${FIELD_LIMITS.ENGINE_NO_MIN}-${FIELD_LIMITS.ENGINE_NO_MAX} characters`),
  
  createDateIssuedValidator(),
  createExpiryDateValidator(),
  
  body('document_images')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      if (value !== undefined && value !== null && value !== 'null') {
        if (!Array.isArray(value)) {
          throw new Error('Document images must be an array');
        }
        if (value.length > FIELD_LIMITS.DOCUMENT_IMAGES_MAX) {
          throw new Error(`Document images array cannot contain more than ${FIELD_LIMITS.DOCUMENT_IMAGES_MAX} items`);
        }
      }
      return true;
    }),
  body('document_images.*')
    .optional()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      if (value && !isHttpUrl(value)) {
        throw new Error('Each document image must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  body('plate_number')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.PLATE_NUMBER_MIN, max: FIELD_LIMITS.PLATE_NUMBER_MAX }).withMessage(`Plate number must be ${FIELD_LIMITS.PLATE_NUMBER_MIN}-${FIELD_LIMITS.PLATE_NUMBER_MAX} characters`),
  body('type')
    .optional({ values: 'null' })
    .trim()
    .isIn([PLATE_TYPES.NORMAL, PLATE_TYPES.CUSTOMIZED, PLATE_TYPES.DEALERSHIP]).withMessage('Type must be Normal, Customized, or Dealership'),
  body('preferred_name')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.PREFERRED_NAME_MIN, max: FIELD_LIMITS.PREFERRED_NAME_MAX }).withMessage(`Preferred name must be ${FIELD_LIMITS.PREFERRED_NAME_MIN}-${FIELD_LIMITS.PREFERRED_NAME_MAX} characters`),
  body('business_type')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.BUSINESS_TYPE_MIN, max: FIELD_LIMITS.BUSINESS_TYPE_MAX }).withMessage(`Business type must be ${FIELD_LIMITS.BUSINESS_TYPE_MIN}-${FIELD_LIMITS.BUSINESS_TYPE_MAX} characters`),
  body('cac_document')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.cac_document && req.uploadedFiles.cac_document.length > 0) {
        return true;
      }
      
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('CAC document must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('letterhead')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.letterhead && req.uploadedFiles.letterhead.length > 0) {
        return true;
      }
      
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Letterhead must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('means_of_identification')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.means_of_identification && req.uploadedFiles.means_of_identification.length > 0) {
        return true;
      }
      
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Means of identification must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  createDealershipFieldValidator('company_name', 'Company name is required for dealership plate applications', 
    (v) => v.isLength({ min: FIELD_LIMITS.COMPANY_NAME_MIN, max: FIELD_LIMITS.COMPANY_NAME_MAX }).withMessage(`Company name must be ${FIELD_LIMITS.COMPANY_NAME_MIN}-${FIELD_LIMITS.COMPANY_NAME_MAX} characters`)),
  createDealershipFieldValidator('company_address', 'Company address is required for dealership plate applications',
    (v) => v.isLength({ min: FIELD_LIMITS.COMPANY_ADDRESS_MIN, max: FIELD_LIMITS.COMPANY_ADDRESS_MAX }).withMessage(`Company address must be ${FIELD_LIMITS.COMPANY_ADDRESS_MIN}-${FIELD_LIMITS.COMPANY_ADDRESS_MAX} characters`)),
  createDealershipFieldValidator('company_phone', 'Company phone is required for dealership plate applications',
    (v) => v.isMobilePhone('any').withMessage('Invalid company phone number')),
  createDealershipFieldValidator('cac_number', 'CAC number is required for dealership plate applications',
    (v) => v.isLength({ min: FIELD_LIMITS.CAC_NUMBER_MIN, max: FIELD_LIMITS.CAC_NUMBER_MAX }).withMessage(`CAC number must be ${FIELD_LIMITS.CAC_NUMBER_MIN}-${FIELD_LIMITS.CAC_NUMBER_MAX} characters`))
];

export const updateCarValidation = [
  body('name_of_owner')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Name of owner cannot be empty')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX }).withMessage(`Name of owner must be ${FIELD_LIMITS.NAME_MIN}-${FIELD_LIMITS.NAME_MAX} characters`),
  body('address')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Address cannot be empty')
    .isLength({ min: FIELD_LIMITS.ADDRESS_MIN, max: FIELD_LIMITS.ADDRESS_MAX }).withMessage(`Address must be ${FIELD_LIMITS.ADDRESS_MIN}-${FIELD_LIMITS.ADDRESS_MAX} characters`),
  body('phone_number')
    .optional({ values: 'null' })
    .trim()
    .isMobilePhone('any').withMessage('Invalid phone number'),
  body('vehicle_make')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Vehicle make cannot be empty')
    .isLength({ min: FIELD_LIMITS.VEHICLE_MAKE_MIN, max: FIELD_LIMITS.VEHICLE_MAKE_MAX }).withMessage(`Vehicle make must be ${FIELD_LIMITS.VEHICLE_MAKE_MIN}-${FIELD_LIMITS.VEHICLE_MAKE_MAX} characters`),
  body('vehicle_model')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Vehicle model cannot be empty')
    .isLength({ min: FIELD_LIMITS.VEHICLE_MODEL_MIN, max: FIELD_LIMITS.VEHICLE_MODEL_MAX }).withMessage(`Vehicle model must be ${FIELD_LIMITS.VEHICLE_MODEL_MIN}-${FIELD_LIMITS.VEHICLE_MODEL_MAX} characters`),
  body('vehicle_year')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value !== null && value !== undefined && value !== '') {
        const parsedYear = parseInt(value, 10);
        if (isNaN(parsedYear) || parsedYear < FIELD_LIMITS.VEHICLE_YEAR_MIN || parsedYear > currentYear + FIELD_LIMITS.VEHICLE_YEAR_MAX_OFFSET) {
          throw new Error(`Vehicle year must be between ${FIELD_LIMITS.VEHICLE_YEAR_MIN} and ${currentYear + FIELD_LIMITS.VEHICLE_YEAR_MAX_OFFSET}`);
        }
      }
      return true;
    }),
  body('vehicle_color')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Vehicle color cannot be empty')
    .isLength({ min: FIELD_LIMITS.VEHICLE_COLOR_MIN, max: FIELD_LIMITS.VEHICLE_COLOR_MAX }).withMessage(`Vehicle color must be ${FIELD_LIMITS.VEHICLE_COLOR_MIN}-${FIELD_LIMITS.VEHICLE_COLOR_MAX} characters`),
  body('car_type')
    .optional({ values: 'null' })
    .trim()
    .isIn([CAR_TYPES.PRIVATE, CAR_TYPES.COMMERCIAL]).withMessage('Car type must be either private or commercial'),
  body('registration_status')
    .optional({ values: 'null' })
    .trim()
    .isIn([REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.UNREGISTERED]).withMessage('Registration status must be either registered or unregistered'),
  
  body('registration_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.REGISTRATION_NO_MIN, max: FIELD_LIMITS.REGISTRATION_NO_MAX }).withMessage(`Registration number must be ${FIELD_LIMITS.REGISTRATION_NO_MIN}-${FIELD_LIMITS.REGISTRATION_NO_MAX} characters`),
  body('chasis_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.CHASIS_NO_MIN, max: FIELD_LIMITS.CHASIS_NO_MAX }).withMessage(`Chasis number must be ${FIELD_LIMITS.CHASIS_NO_MIN}-${FIELD_LIMITS.CHASIS_NO_MAX} characters`),
  body('engine_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.ENGINE_NO_MIN, max: FIELD_LIMITS.ENGINE_NO_MAX }).withMessage(`Engine number must be ${FIELD_LIMITS.ENGINE_NO_MIN}-${FIELD_LIMITS.ENGINE_NO_MAX} characters`),
  
  createDateIssuedValidator(),
  createExpiryDateValidator(),
  
  body('document_images')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      if (value !== undefined && value !== null && value !== 'null') {
        if (!Array.isArray(value)) {
          throw new Error('Document images must be an array');
        }
        if (value.length > FIELD_LIMITS.DOCUMENT_IMAGES_MAX) {
          throw new Error(`Document images array cannot contain more than ${FIELD_LIMITS.DOCUMENT_IMAGES_MAX} items`);
        }
      }
      return true;
    }),
  body('document_images.*')
    .optional()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      if (value && !isHttpUrl(value)) {
        throw new Error('Each document image must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  body('plate_number')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.PLATE_NUMBER_MIN, max: FIELD_LIMITS.PLATE_NUMBER_MAX }).withMessage(`Plate number must be ${FIELD_LIMITS.PLATE_NUMBER_MIN}-${FIELD_LIMITS.PLATE_NUMBER_MAX} characters`),
  body('type')
    .optional({ values: 'null' })
    .trim()
    .isIn([PLATE_TYPES.NORMAL, PLATE_TYPES.CUSTOMIZED, PLATE_TYPES.DEALERSHIP]).withMessage('Type must be Normal, Customized, or Dealership'),
  body('preferred_name')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.PREFERRED_NAME_MIN, max: FIELD_LIMITS.PREFERRED_NAME_MAX }).withMessage(`Preferred name must be ${FIELD_LIMITS.PREFERRED_NAME_MIN}-${FIELD_LIMITS.PREFERRED_NAME_MAX} characters`),
  body('business_type')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: FIELD_LIMITS.BUSINESS_TYPE_MIN, max: FIELD_LIMITS.BUSINESS_TYPE_MAX }).withMessage(`Business type must be ${FIELD_LIMITS.BUSINESS_TYPE_MIN}-${FIELD_LIMITS.BUSINESS_TYPE_MAX} characters`),
  body('cac_document')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.cac_document && req.uploadedFiles.cac_document.length > 0) {
        return true;
      }
      
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('CAC document must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('letterhead')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.letterhead && req.uploadedFiles.letterhead.length > 0) {
        return true;
      }
      
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Letterhead must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('means_of_identification')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      if (req.uploadedFiles?.means_of_identification && req.uploadedFiles.means_of_identification.length > 0) {
        return true;
      }
      
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Means of identification must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  createDealershipFieldValidator('company_name', 'Company name is required for dealership plate applications', 
    (v) => v.isLength({ min: FIELD_LIMITS.COMPANY_NAME_MIN, max: FIELD_LIMITS.COMPANY_NAME_MAX }).withMessage(`Company name must be ${FIELD_LIMITS.COMPANY_NAME_MIN}-${FIELD_LIMITS.COMPANY_NAME_MAX} characters`)),
  createDealershipFieldValidator('company_address', 'Company address is required for dealership plate applications',
    (v) => v.isLength({ min: FIELD_LIMITS.COMPANY_ADDRESS_MIN, max: FIELD_LIMITS.COMPANY_ADDRESS_MAX }).withMessage(`Company address must be ${FIELD_LIMITS.COMPANY_ADDRESS_MIN}-${FIELD_LIMITS.COMPANY_ADDRESS_MAX} characters`)),
  createDealershipFieldValidator('company_phone', 'Company phone is required for dealership plate applications',
    (v) => v.isMobilePhone('any').withMessage('Invalid company phone number')),
  createDealershipFieldValidator('cac_number', 'CAC number is required for dealership plate applications',
    (v) => v.isLength({ min: FIELD_LIMITS.CAC_NUMBER_MIN, max: FIELD_LIMITS.CAC_NUMBER_MAX }).withMessage(`CAC number must be ${FIELD_LIMITS.CAC_NUMBER_MIN}-${FIELD_LIMITS.CAC_NUMBER_MAX} characters`))
];
