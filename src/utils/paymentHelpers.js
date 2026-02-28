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

export function calculateNewExpiryDate(currentExpiryDate, renewalMonths = 12) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  let baseDate;
  
  if (currentExpiryDate) {
    const expiry = new Date(currentExpiryDate);
    expiry.setUTCHours(0, 0, 0, 0);
    baseDate = expiry < today ? today : expiry;
  } else {
    baseDate = today;
  }
  
  const newExpiry = new Date(baseDate);
  newExpiry.setMonth(newExpiry.getMonth() + renewalMonths);
  
  return newExpiry.toISOString().split('T')[0];
}

export function getMonthsForPlan(plan) {
  return PLAN_MONTHS[plan] || 12;
}

export function calculateNextBillingDate(lastBillingDate, plan = 'annual') {
  const months = getMonthsForPlan(plan);
  const base = lastBillingDate ? new Date(lastBillingDate) : new Date();
  base.setMonth(base.getMonth() + months);
  return base.toISOString().split('T')[0];
}

export function isWithinDays(date, days) {
  const targetDate = new Date(date);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + days);
  
  return targetDate <= futureDate && targetDate >= today;
}

export function daysUntil(date) {
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

export function isValidPaymentReference(reference) {
  if (!reference || typeof reference !== 'string') {
    return false;
  }
  
  const internalPattern = /^PAY-[A-Z0-9]+-[A-F0-9]+$/;
  const paystackPattern = /^[a-zA-Z0-9_-]+$/;
  
  return internalPattern.test(reference) || paystackPattern.test(reference);
}

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
  deliveryDetails = null,
  // Plate number specific (optional)
  plateType = null,
  subType = null,
  // Driver license specific (optional)
  licenseType = null
}) {
  const scheduleIds = paymentScheduleId.length > 0 ? paymentScheduleId : selectedItems;
  
  return sanitizeMetadata({
    car_id: carId,
    car_slug: carSlug,
    payment_type: paymentType,
    renewal_months: renewalMonths,
    user_id: userId,
    selected_items: selectedItems,
    paymentScheduleId: scheduleIds,
    renewal_amount: renewalAmount,
    delivery_fee: deliveryFee,
    delivery_details: deliveryDetails,
    ...(plateType ? { plate_type: plateType, sub_type: subType } : {}),
    ...(licenseType ? { license_type: licenseType } : {}),
    initiated_at: new Date().toISOString()
  });
}

