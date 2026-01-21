import { uploadFiles, uploadFile, deleteFile } from '../services/fileUpload.service.js';
import { FILE_UPLOAD_FIELDS } from '../constants/car.constants.js';
import { logError } from './logger.js';

/**
 * Handles file uploads for car registration/update
 * @param {Object} uploadedFiles - Files from request
 * @param {string} userId - User ID
 * @param {string} carSlug - Car slug (optional, for updates)
 * @returns {Promise<Object>} Object with uploadedFileUrls and tempFileUrls
 */
export const handleFileUploads = async (uploadedFiles, userId, carSlug = null) => {
  const uploadedFileUrls = {};
  const tempFileUrls = [];

  if (!uploadedFiles) {
    return { uploadedFileUrls, tempFileUrls };
  }

  for (const config of FILE_UPLOAD_FIELDS) {
    const files = uploadedFiles[config.key];
    if (!files || files.length === 0) continue;

    if (config.isArray) {
      const urls = await uploadFiles(files, userId, carSlug);
      uploadedFileUrls[config.key] = urls;
      tempFileUrls.push(...urls);
    } else {
      const url = await uploadFile(
        files[0].buffer,
        files[0].originalname,
        files[0].mimetype,
        userId,
        carSlug
      );
      uploadedFileUrls[config.key] = url;
      tempFileUrls.push(url);
    }
  }

  return { uploadedFileUrls, tempFileUrls };
};

/**
 * Gets list of files to delete when updating car files
 * @param {Object} existingCar - Existing car data
 * @param {Object} uploadedFileUrls - Newly uploaded file URLs
 * @returns {Array<string>} Array of file URLs to delete
 */
export const getFilesToDelete = (existingCar, uploadedFileUrls) => {
  const filesToDelete = [];

  if (uploadedFileUrls.document_images && existingCar.document_images) {
    if (Array.isArray(existingCar.document_images)) {
      filesToDelete.push(...existingCar.document_images);
    }
  }

  ['cac_document', 'letterhead', 'means_of_identification'].forEach(key => {
    if (uploadedFileUrls[key] && existingCar[key]) {
      filesToDelete.push(existingCar[key]);
    }
  });

  return filesToDelete;
};

/**
 * Monitors file cleanup operations and logs failures
 * @param {Array<string>} fileUrls - URLs of files to delete
 * @param {string} operation - Operation name (for logging)
 * @returns {Promise<void>}
 */
export const monitorFileCleanup = async (fileUrls, operation) => {
  if (!fileUrls || fileUrls.length === 0) return;

  const results = await Promise.allSettled(
    fileUrls.map(url => deleteFile(url))
  );

  const failed = results.filter(r => r.status === 'rejected');
  
  if (failed.length > 0) {
    logError('File cleanup partially failed', {
      operation,
      totalFiles: fileUrls.length,
      failedCount: failed.length,
      failedFiles: failed.map((r, i) => ({
        url: fileUrls[i],
        error: r.reason?.message || 'Unknown error'
      }))
    });
  }
};
