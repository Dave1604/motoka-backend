import crypto from 'crypto';
import {
  PAYMENT_LIMITS,
  REFERENCE_PREFIX,
  PLAN_MONTHS,
  ERROR_MESSAGES
} from '../constants/payment.constants.js';

export function generatePaymentReference() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${REFERENCE_PREFIX.PAYMENT}-${timestamp}-${randomPart}`;
}

export function generateSubscriptionCode() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${REFERENCE_PREFIX.SUBSCRIPTION}-${timestamp}-${randomPart}`;
}

export function generateOrderNumber() {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${REFERENCE_PREFIX.ORDER}-${datePart}-${randomPart}`;
}

export function validatePaymentAmount(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return { valid: false, error: ERROR_MESSAGES.INVALID_AMOUNT };
  }
  
  if (!Number.isInteger(amount)) {
    return { valid: false, error: 'Amount must be a whole number (in kobo)' };
  }
  
  if (amount < PAYMENT_LIMITS.MIN_AMOUNT) {
    return { valid: false, error: ERROR_MESSAGES.AMOUNT_TOO_LOW };
  }
  
  if (amount > PAYMENT_LIMITS.MAX_AMOUNT) {
    return { valid: false, error: ERROR_MESSAGES.AMOUNT_TOO_HIGH };
  }
  
  return { valid: true };
}

export function nairaToKobo(naira) {
  return Math.round(naira * 100);
}

export function koboToNaira(kobo) {
  return kobo / 100;
}

export function formatAmount(kobo, currency = 'NGN') {
  const naira = koboToNaira(kobo);
  
  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2
  });
  
  return formatter.format(naira);
}

/**
 * Calculate new expiry date based on current expiry and renewal months
 * 
 * @param {string|Date} currentExpiryDate - Current expiry date
 * @param {number} renewalMonths - Number of months to add (default: 12)
 * @returns {string} New expiry date in YYYY-MM-DD format
 */
export function calculateNewExpiryDate(currentExpiryDate, renewalMonths = 12) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  let baseDate;
  
  if (currentExpiryDate) {
    const expiry = new Date(currentExpiryDate);
    expiry.setUTCHours(0, 0, 0, 0);
    
    // If already expired, start from today; otherwise, start from current expiry
    baseDate = expiry < today ? today : expiry;
  } else {
    // No expiry date set, start from today
    baseDate = today;
  }
  
  // Add renewal months
  const newExpiry = new Date(baseDate);
  newExpiry.setMonth(newExpiry.getMonth() + renewalMonths);
  
  // Return as YYYY-MM-DD
  return newExpiry.toISOString().split('T')[0];
}

/**
 * Get the number of months for a subscription plan
 * 
 * @param {string} plan - Subscription plan (annual, biannual, quarterly)
 * @returns {number} Number of months
 */
export function getMonthsForPlan(plan) {
  return PLAN_MONTHS[plan] || 12;
}

/**
 * Calculate next billing date for a subscription
 * 
 * @param {string|Date} lastBillingDate - Last billing date (or null for new)
 * @param {string} plan - Subscription plan
 * @returns {string} Next billing date in YYYY-MM-DD format
 */
export function calculateNextBillingDate(lastBillingDate, plan = 'annual') {
  const months = getMonthsForPlan(plan);
  const base = lastBillingDate ? new Date(lastBillingDate) : new Date();
  base.setMonth(base.getMonth() + months);
  return base.toISOString().split('T')[0];
}

/**
 * Check if a date is within N days from now
 * 
 * @param {string|Date} date - Date to check
 * @param {number} days - Number of days
 * @returns {boolean} True if date is within the specified days
 */
export function isWithinDays(date, days) {
  const targetDate = new Date(date);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + days);
  
  return targetDate <= futureDate && targetDate >= today;
}

/**
 * Calculate days until a date
 * 
 * @param {string|Date} date - Target date
 * @returns {number} Number of days (negative if past)
 */
export function daysUntil(date) {
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get today's date in YYYY-MM-DD format
 * 
 * @returns {string} Today's date
 */
export function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Validate a payment reference format
 * 
 * @param {string} reference - Reference to validate
 * @returns {boolean} True if valid format
 */
export function isValidPaymentReference(reference) {
  if (!reference || typeof reference !== 'string') {
    return false;
  }
  
  // Format: PAY-{timestamp}-{random} or Paystack format
  const internalPattern = /^PAY-[A-Z0-9]+-[A-F0-9]+$/;
  const paystackPattern = /^[a-zA-Z0-9_-]+$/;
  
  return internalPattern.test(reference) || paystackPattern.test(reference);
}

/**
 * Sanitize metadata object (remove sensitive fields)
 * 
 * @param {Object} metadata - Metadata object
 * @returns {Object} Sanitized metadata
 */
export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  
  const sensitiveFields = ['password', 'secret', 'token', 'key', 'authorization'];
  const sanitized = { ...metadata };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      delete sanitized[field];
    }
  }
  
  return sanitized;
}

/**
 * Build payment metadata object
 * 
 * @param {Object} options - Options for metadata
 * @returns {Object} Structured metadata
 */
export function buildPaymentMetadata({
  carId,
  carSlug,
  paymentType,
  renewalMonths,
  userId,
  selectedItems = [],
  paymentScheduleId = [],
  renewalAmount = null,
  deliveryFee = 0,
  deliveryDetails = null
}) {
  // Support both selectedItems (legacy) and paymentScheduleId (new)
  const scheduleIds = paymentScheduleId.length > 0 ? paymentScheduleId : selectedItems;
  
  return sanitizeMetadata({
    car_id: carId,
    car_slug: carSlug,
    payment_type: paymentType,
    renewal_months: renewalMonths,
    user_id: userId,
    selected_items: selectedItems, // Keep for backward compatibility
    paymentScheduleId: scheduleIds, // New field for frontend
    renewal_amount: renewalAmount,
    delivery_fee: deliveryFee,
    delivery_details: deliveryDetails,
    initiated_at: new Date().toISOString()
  });
}

