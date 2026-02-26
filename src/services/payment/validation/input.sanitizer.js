/**
 * Input Sanitization Service
 * 
 * Sanitizes and validates customer data before sending to external payment
 * gateways to prevent XSS, injection attacks, and data corruption.
 * 
 * This service implements Phase 2 remediation to ensure all customer inputs
 * are sanitized before external API calls.
 * 
 * Uses the validator library (available via express-validator dependency)
 * for consistency with the codebase.
 */

import validator from 'validator';

/**
 * Custom error for input validation failures
 */
export class InputValidationError extends Error {
  constructor(message, field, value) {
    super(message);
    this.name = 'InputValidationError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Sanitizes a string using validator's trim and escape functions
 * 
 * @param {string} value - String to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  
  // Trim whitespace only — do NOT HTML-escape. This data goes to a payment
  // API (Monicredit), not into HTML. validator.escape() would corrupt names
  // like "O'Brien" into "O&#x27;Brien" and cause API 400 rejections.
  let sanitized = validator.trim(value);
  
  // Remove control characters (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  
  // Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validates and sanitizes email address using validator
 * 
 * @param {string} email - Email to validate
 * @returns {string} Sanitized email
 * @throws {InputValidationError} If email is invalid
 */
function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new InputValidationError('Email is required', 'email', email);
  }
  
  // Normalize and validate email using validator
  const sanitized = validator.normalizeEmail(email.trim().toLowerCase());
  
  if (!sanitized || !validator.isEmail(sanitized)) {
    throw new InputValidationError('Invalid email format', 'email', email);
  }
  
  if (sanitized.length > 255) {
    throw new InputValidationError('Email exceeds maximum length of 255 characters', 'email', email);
  }
  
  return sanitized;
}

/**
 * Validates and sanitizes phone number using validator
 * 
 * @param {string} phone - Phone number to sanitize
 * @returns {string} Sanitized phone number
 */
function sanitizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  
  // Trim and escape using validator
  let sanitized = validator.trim(phone);
  sanitized = validator.escape(sanitized);
  
  // Remove all non-digit characters except + at the start
  if (sanitized.startsWith('+')) {
    sanitized = '+' + sanitized.substring(1).replace(/\D/g, '');
  } else {
    sanitized = sanitized.replace(/\D/g, '');
  }
  
  // Enforce length limit (20 characters)
  if (sanitized.length > 20) {
    sanitized = sanitized.substring(0, 20);
  }
  
  return sanitized;
}

/**
 * Validates and sanitizes NIN (National Identification Number) using validator
 * 
 * @param {string} nin - NIN to sanitize
 * @returns {string} Sanitized NIN
 */
function sanitizeNIN(nin) {
  if (!nin || typeof nin !== 'string') {
    return '';
  }
  
  // Trim, escape, and remove non-alphanumeric characters
  let sanitized = validator.trim(nin);
  sanitized = validator.escape(sanitized);
  sanitized = sanitized.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  
  // Enforce length limit (20 characters)
  if (sanitized.length > 20) {
    sanitized = sanitized.substring(0, 20);
  }
  
  return sanitized;
}

/**
 * Sanitizes customer data before sending to payment gateway
 * 
 * @param {Object} customerData - Customer data object
 * @param {string} customerData.first_name - First name
 * @param {string} customerData.last_name - Last name
 * @param {string} customerData.email - Email address (required)
 * @param {string} [customerData.phone] - Phone number (optional)
 * @param {string} [customerData.nin] - National Identification Number (optional)
 * @returns {Object} Sanitized customer data
 * @throws {InputValidationError} If required fields are missing or invalid
 */
export function sanitizeCustomerData(customerData) {
  if (!customerData || typeof customerData !== 'object') {
    throw new InputValidationError('Customer data is required', 'customerData', customerData);
  }
  
  // Email is required
  const email = sanitizeEmail(customerData.email);
  
  // Sanitize first name (required, max 100 chars)
  const firstName = sanitizeString(customerData.first_name || '', 100);
  if (!firstName) {
    throw new InputValidationError('First name is required', 'first_name', customerData.first_name);
  }
  
  // Sanitize last name (required, max 100 chars)
  const lastName = sanitizeString(customerData.last_name || '', 100);
  if (!lastName) {
    throw new InputValidationError('Last name is required', 'last_name', customerData.last_name);
  }
  
  // Sanitize phone (optional, max 20 chars)
  const phone = sanitizePhone(customerData.phone || '');
  
  // Sanitize NIN (optional, max 20 chars)
  const nin = customerData.nin ? sanitizeNIN(customerData.nin) : undefined;
  
  return {
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    ...(nin && { nin })
  };
}
