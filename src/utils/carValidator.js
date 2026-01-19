import { body } from 'express-validator';

// Prevents javascript: and data: URL injection attacks
const isHttpUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  if (value.length > 2048) {
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

export const addCarValidation = [
  body('name_of_owner')
    .trim()
    .notEmpty().withMessage('Name of owner is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name of owner must be 2-100 characters'),
  body('address')
    .trim()
    .notEmpty().withMessage('Address is required')
    .isLength({ min: 5, max: 500 }).withMessage('Address must be 5-500 characters'),
  body('phone_number')
    .optional({ values: 'null' })
    .trim()
    .isMobilePhone('any').withMessage('Invalid phone number'),
  
  body('vehicle_make')
    .trim()
    .notEmpty().withMessage('Vehicle make is required')
    .isLength({ min: 1, max: 50 }).withMessage('Vehicle make must be 1-50 characters'),
  body('vehicle_model')
    .trim()
    .notEmpty().withMessage('Vehicle model is required')
    .isLength({ min: 1, max: 50 }).withMessage('Vehicle model must be 1-50 characters'),
  body('vehicle_year')
    .notEmpty().withMessage('Vehicle year is required')
    .isInt({ min: 1900, max: currentYear + 1 }).withMessage(`Vehicle year must be between 1900 and ${currentYear + 1}`),
  body('vehicle_color')
    .trim()
    .notEmpty().withMessage('Vehicle color is required')
    .isLength({ min: 2, max: 30 }).withMessage('Vehicle color must be 2-30 characters'),
  body('car_type')
    .trim()
    .notEmpty().withMessage('Car type is required')
    .isIn(['private', 'commercial']).withMessage('Car type must be either private or commercial'),
  body('registration_status')
    .trim()
    .notEmpty().withMessage('Registration status is required')
    .isIn(['registered', 'unregistered']).withMessage('Registration status must be either registered or unregistered'),
  
  body('registration_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 20 }).withMessage('Registration number must be 1-20 characters'),
  body('chasis_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 30 }).withMessage('Chasis number must be 1-30 characters'),
  body('engine_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 30 }).withMessage('Engine number must be 1-30 characters'),
  
  body('date_issued')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.registration_status === 'registered') {
        if (!value || value === 'null' || value === '') {
          throw new Error('Date issued is required for registered cars');
        }
      }
      return true;
    })
    .isISO8601().withMessage('Date issued must be a valid date'),
  body('expiry_date')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.registration_status === 'registered') {
        if (!value || value === 'null' || value === '') {
          throw new Error('Expiry date is required for registered cars');
        }
        if (req.body.date_issued && new Date(value) <= new Date(req.body.date_issued)) {
          throw new Error('Expiry date must be after date issued');
        }
      }
      return true;
    })
    .isISO8601().withMessage('Expiry date must be a valid date'),
  
  body('document_images')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      // If files are uploaded, skip URL validation
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL array
      if (value !== undefined && value !== null && value !== 'null') {
        if (!Array.isArray(value)) {
          throw new Error('Document images must be an array');
        }
        if (value.length > 10) {
          throw new Error('Document images array cannot contain more than 10 items');
        }
      }
      return true;
    }),
  body('document_images.*')
    .optional()
    .custom((value, { req }) => {
      // If files are uploaded, skip URL validation
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && !isHttpUrl(value)) {
        throw new Error('Each document image must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  body('plate_number')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 20 }).withMessage('Plate number must be 1-20 characters'),
  body('type')
    .optional({ values: 'null' })
    .trim()
    .isIn(['Normal', 'Customized', 'Dealership']).withMessage('Type must be Normal, Customized, or Dealership'),
  body('preferred_name')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Preferred name must be 1-100 characters'),
  body('business_type')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Business type must be 1-50 characters'),
  body('cac_document')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      // If file is uploaded, skip URL validation
      if (req.uploadedFiles?.cac_document && req.uploadedFiles.cac_document.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('CAC document must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('letterhead')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      // If file is uploaded, skip URL validation
      if (req.uploadedFiles?.letterhead && req.uploadedFiles.letterhead.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Letterhead must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('means_of_identification')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      // If file is uploaded, skip URL validation
      if (req.uploadedFiles?.means_of_identification && req.uploadedFiles.means_of_identification.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Means of identification must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  body('company_name')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('Company name is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Company name must be 1-100 characters'),
  body('company_address')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('Company address is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isLength({ min: 5, max: 500 }).withMessage('Company address must be 5-500 characters'),
  body('company_phone')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('Company phone is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isMobilePhone('any').withMessage('Invalid company phone number'),
  body('cac_number')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('CAC number is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('CAC number must be 1-50 characters')
];

export const updateCarValidation = [
  body('name_of_owner')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Name of owner cannot be empty')
    .isLength({ min: 2, max: 100 }).withMessage('Name of owner must be 2-100 characters'),
  body('address')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Address cannot be empty')
    .isLength({ min: 5, max: 500 }).withMessage('Address must be 5-500 characters'),
  body('phone_number')
    .optional({ values: 'null' })
    .trim()
    .isMobilePhone('any').withMessage('Invalid phone number'),
  body('vehicle_make')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Vehicle make cannot be empty')
    .isLength({ min: 1, max: 50 }).withMessage('Vehicle make must be 1-50 characters'),
  body('vehicle_model')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Vehicle model cannot be empty')
    .isLength({ min: 1, max: 50 }).withMessage('Vehicle model must be 1-50 characters'),
  body('vehicle_year')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value !== null && value !== undefined && value !== '') {
        const parsedYear = parseInt(value, 10);
        if (isNaN(parsedYear) || parsedYear < 1900 || parsedYear > currentYear + 1) {
          throw new Error(`Vehicle year must be between 1900 and ${currentYear + 1}`);
        }
      }
      return true;
    }),
  body('vehicle_color')
    .optional({ values: 'null' })
    .trim()
    .notEmpty().withMessage('Vehicle color cannot be empty')
    .isLength({ min: 2, max: 30 }).withMessage('Vehicle color must be 2-30 characters'),
  body('car_type')
    .optional({ values: 'null' })
    .trim()
    .isIn(['private', 'commercial']).withMessage('Car type must be either private or commercial'),
  body('registration_status')
    .optional({ values: 'null' })
    .trim()
    .isIn(['registered', 'unregistered']).withMessage('Registration status must be either registered or unregistered'),
  
  body('registration_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 20 }).withMessage('Registration number must be 1-20 characters'),
  body('chasis_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 30 }).withMessage('Chasis number must be 1-30 characters'),
  body('engine_no')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 30 }).withMessage('Engine number must be 1-30 characters'),
  
  body('date_issued')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.registration_status === 'registered') {
        if (!value || value === 'null' || value === '') {
          throw new Error('Date issued is required for registered cars');
        }
      }
      return true;
    })
    .isISO8601().withMessage('Date issued must be a valid date'),
  body('expiry_date')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.registration_status === 'registered') {
        if (!value || value === 'null' || value === '') {
          throw new Error('Expiry date is required for registered cars');
        }
        if (req.body.date_issued && new Date(value) <= new Date(req.body.date_issued)) {
          throw new Error('Expiry date must be after date issued');
        }
      }
      return true;
    })
    .isISO8601().withMessage('Expiry date must be a valid date'),
  
  body('document_images')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      // If files are uploaded, skip URL validation
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL array
      if (value !== undefined && value !== null && value !== 'null') {
        if (!Array.isArray(value)) {
          throw new Error('Document images must be an array');
        }
        if (value.length > 10) {
          throw new Error('Document images array cannot contain more than 10 items');
        }
      }
      return true;
    }),
  body('document_images.*')
    .optional()
    .custom((value, { req }) => {
      // If files are uploaded, skip URL validation
      if (req.uploadedFiles?.document_images && req.uploadedFiles.document_images.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && !isHttpUrl(value)) {
        throw new Error('Each document image must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  body('plate_number')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 20 }).withMessage('Plate number must be 1-20 characters'),
  body('type')
    .optional({ values: 'null' })
    .trim()
    .isIn(['Normal', 'Customized', 'Dealership']).withMessage('Type must be Normal, Customized, or Dealership'),
  body('preferred_name')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Preferred name must be 1-100 characters'),
  body('business_type')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Business type must be 1-50 characters'),
  body('cac_document')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      // If file is uploaded, skip URL validation
      if (req.uploadedFiles?.cac_document && req.uploadedFiles.cac_document.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('CAC document must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('letterhead')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      // If file is uploaded, skip URL validation
      if (req.uploadedFiles?.letterhead && req.uploadedFiles.letterhead.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Letterhead must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  body('means_of_identification')
    .optional({ values: 'null' })
    .trim()
    .custom((value, { req }) => {
      // If file is uploaded, skip URL validation
      if (req.uploadedFiles?.means_of_identification && req.uploadedFiles.means_of_identification.length > 0) {
        return true;
      }
      
      // Otherwise, validate as URL
      if (value && value !== 'null' && !isHttpUrl(value)) {
        throw new Error('Means of identification must be a valid HTTP or HTTPS URL');
      }
      return true;
    }),
  
  body('company_name')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('Company name is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Company name must be 1-100 characters'),
  body('company_address')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('Company address is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isLength({ min: 5, max: 500 }).withMessage('Company address must be 5-500 characters'),
  body('company_phone')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('Company phone is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isMobilePhone('any').withMessage('Invalid company phone number'),
  body('cac_number')
    .optional({ values: 'null' })
    .custom((value, { req }) => {
      if (req.body.type === 'Dealership') {
        if (!value || value === 'null' || value.trim() === '') {
          throw new Error('CAC number is required for dealership plate applications');
        }
      }
      return true;
    })
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('CAC number must be 1-50 characters')
];
