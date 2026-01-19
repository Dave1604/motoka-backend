/**
 * Safe error logging utility that sanitizes error messages in production
 */

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Sanitizes error object to remove sensitive information
 * @param {Error|Object} error - Error object to sanitize
 * @returns {Object} Sanitized error information
 */
const sanitizeError = (error) => {
  if (!error) {
    return { message: 'Unknown error' };
  }

  // In development, show full error details
  if (isDevelopment) {
    return {
      message: error.message || 'Unknown error',
      stack: error.stack,
      code: error.code,
      details: error
    };
  }

  // In production, only show safe error information
  const sanitized = {
    message: error.message || 'An error occurred',
    code: error.code || undefined
  };

  // Only include code if it's a known safe error code
  const safeErrorCodes = ['23505', '23503', '23514']; // PostgreSQL error codes
  if (error.code && safeErrorCodes.includes(error.code)) {
    sanitized.code = error.code;
  }

  return sanitized;
};

/**
 * Logs an error safely
 * @param {string} context - Context where the error occurred (e.g., 'Car insert error')
 * @param {Error|Object} error - Error object to log
 */
export const logError = (context, error) => {
  const sanitized = sanitizeError(error);
  
  if (isDevelopment) {
    // In development, log full error details
    console.error(`${context}:`, sanitized);
    if (sanitized.stack) {
      console.error('Stack trace:', sanitized.stack);
    }
  } else {
    // In production, log only sanitized information
    console.error(`${context}:`, {
      message: sanitized.message,
      code: sanitized.code || 'N/A'
    });
  }
};

export default { logError };
