import multer from 'multer';
import { validateFile, validateFiles } from '../utils/fileValidator.js';

// Configure multer to store files in memory
const storage = multer.memoryStorage();

// File size limits
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

// Configure multer with limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_DOCUMENT_SIZE, // Max size for any file
    files: 12 // Max 10 document_images + 3 single files (cac_document, letterhead, means_of_identification)
  },
  fileFilter: (req, file, cb) => {
    // Basic MIME type check
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedMimes.join(', ')}`), false);
    }
  }
});

/**
 * Middleware to handle file uploads for car registration/update
 * Supports both multipart/form-data (files) and application/json (URLs) for backward compatibility
 */
export const handleCarFileUploads = async (req, res, next) => {
  // Check if request is multipart/form-data
  const contentType = req.headers['content-type'] || '';
  const isMultipart = contentType.includes('multipart/form-data');

  if (!isMultipart) {
    // Not a file upload request, proceed with normal JSON handling
    return next();
  }
  
  // Configure multer fields
  const uploadFields = upload.fields([
    { name: 'document_images', maxCount: 10 },
    { name: 'cac_document', maxCount: 1 },
    { name: 'letterhead', maxCount: 1 },
    { name: 'means_of_identification', maxCount: 1 }
  ]);
  
  // Execute multer middleware
  uploadFields(req, res, async (err) => {
    if (err) {
      // Handle MulterError specifically
      if (err instanceof multer.MulterError) {
        let message = 'File upload error';
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            message = 'File too large. Maximum size is 10MB';
            break;
          case 'LIMIT_FILE_COUNT':
            message = 'Too many files. Maximum is 12 files total';
            break;
          case 'LIMIT_UNEXPECTED_FILE':
            message = `Unexpected file field: ${err.field}`;
            break;
          default:
            message = err.message || 'File upload error';
        }
        return res.status(400).json({
          success: false,
          message: message
        });
      }
      
      // Handle other errors (e.g., from fileFilter)
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error'
      });
    }
    
    // Validate uploaded files
    const files = req.files || {};
    const validationErrors = [];
    
    // Validate document_images array
    if (files.document_images && files.document_images.length > 0) {
      const result = await validateFiles(files.document_images, 10);
      if (!result.valid) {
        validationErrors.push(result.error);
      }
    }
    
    // Validate single file fields
    const singleFileFields = ['cac_document', 'letterhead', 'means_of_identification'];
    for (const fieldName of singleFileFields) {
      if (files[fieldName] && files[fieldName].length > 0) {
        const result = await validateFile(files[fieldName][0], fieldName);
        if (!result.valid) {
          validationErrors.push(result.error);
        }
      }
    }
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'File validation failed',
        errors: validationErrors.map(error => ({ field: 'files', message: error }))
      });
    }
    
    // Attach files to request for controller processing
    req.uploadedFiles = files;

    // Parse other form fields and attach to req.body
    // Multer already does this, but we ensure consistency
    if (req.body && typeof req.body === 'object') {
      // Parse JSON fields if they exist as strings (common with multipart)
      Object.keys(req.body).forEach(key => {
        try {
          if (typeof req.body[key] === 'string' && req.body[key].startsWith('{')) {
            req.body[key] = JSON.parse(req.body[key]);
          } else if (typeof req.body[key] === 'string' && req.body[key].startsWith('[')) {
            req.body[key] = JSON.parse(req.body[key]);
          }
        } catch (e) {
          // Not JSON, keep as string
        }
      });
    }
    
    next();
  });
};

/**
 * Middleware specifically for car registration (POST /reg-car)
 */
export const handleCarRegistrationUploads = handleCarFileUploads;

/**
 * Middleware specifically for car update (PUT /cars/:slug)
 */
export const handleCarUpdateUploads = handleCarFileUploads;
