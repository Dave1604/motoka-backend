// Allowed MIME types for document images
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
];

// Allowed MIME types for documents (CAC, letterhead, means of identification)
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png'
];

// File size limits (in bytes)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

// File extensions mapping
const EXTENSION_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};

// Dangerous file extensions to reject
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
  '.app', '.deb', '.pkg', '.rpm', '.msi', '.dmg', '.sh', '.ps1', '.py',
  '.php', '.rb', '.pl', '.asp', '.aspx', '.jsp', '.html', '.htm', '.xml'
];

/**
 * Validates file type by checking magic numbers (file signatures)
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - Expected MIME type
 * @returns {boolean} - True if file type matches
 */
const validateFileSignature = (buffer, mimeType) => {
  if (!buffer || buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  // PNG: 89 50 4E 47
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  // WebP: RIFF...WEBP
  if (mimeType === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && 
           buffer.toString('ascii', 8, 12) === 'WEBP';
  }

  // PDF: %PDF
  if (mimeType === 'application/pdf') {
    return buffer.toString('ascii', 0, 4) === '%PDF';
  }

  return false;
};

/**
 * Checks if filename has dangerous extension
 * @param {string} filename - Original filename
 * @returns {boolean} - True if dangerous
 */
const hasDangerousExtension = (filename) => {
  const lowerFilename = filename.toLowerCase();
  return DANGEROUS_EXTENSIONS.some(ext => lowerFilename.endsWith(ext));
};

/**
 * Checks for double extensions (e.g., file.pdf.exe)
 * @param {string} filename - Original filename
 * @returns {boolean} - True if has double extension
 */
const hasDoubleExtension = (filename) => {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 3) return false;
  
  // Check if any part before the last is a dangerous extension
  for (let i = 1; i < parts.length - 1; i++) {
    const ext = '.' + parts[i];
    if (DANGEROUS_EXTENSIONS.includes(ext)) {
      return true;
    }
  }
  return false;
};

/**
 * Validates a single file
 * @param {Object} file - Multer file object
 * @param {string} fieldName - Field name (document_images, cac_document, etc.)
 * @returns {Promise<Object>} - { valid: boolean, error?: string }
 */
export const validateFile = async (file, fieldName) => {
  if (!file) {
    return { valid: true }; // Optional fields
  }

  // Check file size
  const isImageField = fieldName === 'document_images';
  const maxSize = isImageField ? MAX_IMAGE_SIZE : MAX_DOCUMENT_SIZE;
  const allowedTypes = isImageField ? ALLOWED_IMAGE_TYPES : ALLOWED_DOCUMENT_TYPES;

  if (file.size > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024);
    return {
      valid: false,
      error: `File "${file.originalname}" exceeds maximum size of ${maxSizeMB}MB`
    };
  }

  // Check for dangerous extensions
  if (hasDangerousExtension(file.originalname)) {
    return {
      valid: false,
      error: `File "${file.originalname}" has a prohibited file type`
    };
  }

  // Check for double extensions
  if (hasDoubleExtension(file.originalname)) {
    return {
      valid: false,
      error: `File "${file.originalname}" appears to have a suspicious double extension`
    };
  }

  // Validate MIME type
  if (!allowedTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `File "${file.originalname}" has invalid MIME type. Allowed types: ${allowedTypes.join(', ')}`
    };
  }

  // Validate file signature (magic numbers)
  try {
    const fileBuffer = file.buffer || Buffer.from([]);
    if (fileBuffer.length > 0) {
      // Validate signature matches declared MIME type
      if (!validateFileSignature(fileBuffer, file.mimetype)) {
        return {
          valid: false,
          error: `File "${file.originalname}" failed signature validation. File content does not match declared type ${file.mimetype}`
        };
      }
    }
  } catch (error) {
    return {
      valid: false,
      error: `Error validating file "${file.originalname}": ${error.message}`
    };
  }

  return { valid: true };
};

/**
 * Validates multiple files (for document_images array)
 * @param {Array} files - Array of Multer file objects
 * @param {number} maxCount - Maximum number of files allowed
 * @returns {Promise<Object>} - { valid: boolean, error?: string }
 */
export const validateFiles = async (files, maxCount = 10) => {
  if (!files || files.length === 0) {
    return { valid: true }; // Optional field
  }

  if (files.length > maxCount) {
    return {
      valid: false,
      error: `Maximum ${maxCount} files allowed, received ${files.length}`
    };
  }

  for (const file of files) {
    const result = await validateFile(file, 'document_images');
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
};

/**
 * Gets file extension from filename
 * @param {string} filename - Original filename
 * @returns {string} - File extension (with dot)
 */
export const getFileExtension = (filename) => {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot).toLowerCase();
};
