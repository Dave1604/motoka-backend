/**
 * Response Validator
 * 
 * Validates normalized gateway responses to ensure they match expected schemas.
 * This helps catch API changes early and prevents malformed responses from
 * causing errors downstream.
 */

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(message, field = null, value = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Validate payment initialization response
 * 
 * @param {Object} response - Normalized init response
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function validateInitResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new ValidationError('Init response must be an object', 'response', response);
  }
  
  if (!response.reference || typeof response.reference !== 'string') {
    throw new ValidationError('Init response must have a valid reference', 'reference', response.reference);
  }
  
  if (typeof response.amount !== 'number' || response.amount <= 0) {
    throw new ValidationError('Init response must have a valid amount', 'amount', response.amount);
  }
  
  if (!response.currency || typeof response.currency !== 'string') {
    throw new ValidationError('Init response must have a valid currency', 'currency', response.currency);
  }
  
  return true;
}

/**
 * Validate payment verification response
 * 
 * @param {Object} response - Normalized verify response
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function validateVerifyResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new ValidationError('Verify response must be an object', 'response', response);
  }
  
  if (typeof response.success !== 'boolean') {
    throw new ValidationError('Verify response must have a success boolean', 'success', response.success);
  }
  
  if (!response.status || typeof response.status !== 'string') {
    throw new ValidationError('Verify response must have a valid status', 'status', response.status);
  }
  
  if (typeof response.amount !== 'number' || response.amount < 0) {
    throw new ValidationError('Verify response must have a valid amount', 'amount', response.amount);
  }
  
  if (!response.currency || typeof response.currency !== 'string') {
    throw new ValidationError('Verify response must have a valid currency', 'currency', response.currency);
  }
  
  return true;
}

/**
 * Validate webhook payload
 * 
 * @param {Object} payload - Webhook payload
 * @param {string} gateway - Gateway name ('paystack' or 'monicredit')
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function validateWebhookPayload(payload, gateway) {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Webhook payload must be an object', 'payload', payload);
  }
  
  if (gateway === 'paystack') {
    if (!payload.event || typeof payload.event !== 'string') {
      throw new ValidationError('Paystack webhook must have an event', 'event', payload.event);
    }
    
    if (!payload.data || typeof payload.data !== 'object') {
      throw new ValidationError('Paystack webhook must have data', 'data', payload.data);
    }
  } else if (gateway === 'monipay') {
    const hasRef = payload.reference || payload.data?.reference || payload.order_id || payload.data?.order_id;
    const hasEvent = payload.event || payload.type || payload.status;
    if (!hasRef && !hasEvent) {
      throw new ValidationError('Monipay webhook must have an event or reference', 'event', payload.event);
    }
  } else if (gateway === 'monicredit') {
    // Monicredit webhooks may have varying structures
    const hasOrderId = payload.order_id || payload.data?.order_id || payload.transid;
    if (!hasOrderId) {
      throw new ValidationError('Monicredit webhook must have order_id or transid', 'order_id', payload.order_id);
    }
  }
  
  return true;
}

/**
 * Validate response with optional logging
 * 
 * @param {Function} validator - Validation function
 * @param {Object} response - Response to validate
 * @param {string} context - Context for logging (e.g., 'init', 'verify')
 * @param {boolean} logErrors - Whether to log validation errors
 * @returns {boolean} True if valid
 * @throws {ValidationError} If validation fails
 */
export function validateResponse(validator, response, context = 'unknown', logErrors = true) {
  try {
    return validator(response);
  } catch (error) {
    if (logErrors && error instanceof ValidationError) {
      console.warn(`[Response Validator] Validation failed for ${context}:`, {
        field: error.field,
        value: error.value,
        message: error.message
      });
    }
    throw error;
  }
}
