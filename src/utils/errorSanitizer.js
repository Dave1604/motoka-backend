const SENSITIVE_PATTERNS = [
  /(api[_-]?key|secret|token|password|auth[_-]?token)\s*[:=]\s*['"]?[\w\-]+['"]?/gi,
  /https?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
  /postgres:\/\/[^@]+@[^\s]+/gi,
  /[A-Z]:\\[^\s]+|\.\/[^\s]+|\/[^\s]+/gi,
  /at\s+[\w.]+\([^)]+\)/gi,
  /Error:\s+/gi
];

function sanitizeMessage(message) {
  if (!message || typeof message !== 'string') {
    return 'An error occurred';
  }
  
  let sanitized = message;
  
  SENSITIVE_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });
  
  return sanitized;
}

/**
 * Sanitizes an error object for client responses
 * 
 * In production, removes:
 * - Stack traces
 * - Internal file paths
 * - API keys and secrets
 * - Database connection details
 * - Full error objects (replaces with generic messages)
 * 
 * In development, preserves more details for debugging.
 * 
 * @param {Error|Object|string} error - Error to sanitize
 * @param {boolean} isProduction - Whether running in production mode
 * @returns {Object} Sanitized error object
 */
export function sanitizeError(error, isProduction = false) {
  if (typeof error === 'string') {
    return {
      message: isProduction ? sanitizeMessage(error) : error,
      code: null
    };
  }
  
  if (error instanceof Error) {
    const sanitized = {
      message: isProduction ? sanitizeMessage(error.message) : error.message,
      name: error.name,
      code: error.code || null
    };
    
    if (!isProduction && error.stack) {
      sanitized.stack = sanitizeMessage(error.stack);
    }
    
    if (error.statusCode) {
      sanitized.statusCode = error.statusCode;
    }
    
    return sanitized;
  }
  
  if (error && typeof error === 'object') {
    const sanitized = {
      message: isProduction 
        ? sanitizeMessage(error.message || 'An error occurred')
        : (error.message || 'An error occurred'),
      code: error.code || null
    };
    
    if (error.statusCode) {
      sanitized.statusCode = error.statusCode;
    }
    
    if (!isProduction && error.data) {
      sanitized.data = error.data;
    }
    
    return sanitized;
  }
  
  return {
    message: 'An error occurred',
    code: null
  };
}

export function getUserFriendlyMessage(error) {
  if (typeof error === 'string') {
    return error;
  }
  
  if (error instanceof Error) {
    if (error.name === 'MonicreditError' || error.name === 'PaystackError') {
      // For validation/config errors, surface a useful message
      if (error.code === 'VALIDATION_ERROR') {
        return error.message || 'Invalid payment details. Please check your information.';
      }
      return 'Payment processing error. Please try again or contact support.';
    }
    
    if (error.name === 'AmountValidationError') {
      return 'Payment amount mismatch detected. Please contact support.';
    }
    
    if (error.name === 'InputValidationError') {
      return 'Invalid input provided. Please check your information and try again.';
    }
    
    if (error.name === 'TransactionError') {
      return 'Transaction processing error. Please try again.';
    }
    
    return 'An error occurred. Please try again or contact support.';
  }
  
  if (error && typeof error === 'object' && error.message) {
    return error.message;
  }
  
  return 'An error occurred. Please try again or contact support.';
}
