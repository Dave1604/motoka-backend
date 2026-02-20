import { logger } from '../config/logger.config.js';

const sanitizeError = (error) => {
  if (!error) {
    return { message: 'Unknown error' };
  }

  const sanitized = {
    message: error.message || 'An error occurred'
  };

  const safeErrorCodes = ['23505', '23503', '23514'];
  if (error.code && safeErrorCodes.includes(error.code)) {
    sanitized.code = error.code;
  }

  if (error.statusCode) {
    sanitized.statusCode = error.statusCode;
  }

  if (error.name) {
    sanitized.type = error.name;
  }

  if (process.env.NODE_ENV === 'development' && error.stack) {
    sanitized.stack = error.stack;
  }

  if (error.data) {
    sanitized.data = error.data;
  }

  return sanitized;
};

export const logError = (context, error) => {
  const sanitized = sanitizeError(error);
  logger.error({ context, ...sanitized }, `${context}: ${sanitized.message}`);
};

export const logInfo = (message, data = {}) => {
  logger.info(data, message);
};

export const logWarn = (message, data = {}) => {
  logger.warn(data, message);
};

export const logDebug = (message, data = {}) => {
  logger.debug(data, message);
};

export const logErrorStructured = (message, error) => {
  if (error instanceof Error) {
    logger.error({ err: error }, message);
  } else {
    logger.error(error, message);
  }
};

export { logger };

export default { 
  logError, 
  logInfo, 
  logWarn, 
  logDebug, 
  logErrorStructured,
  logger 
};
