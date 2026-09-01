import crypto from 'crypto';
import { logError, logInfo, logWarn } from '../../utils/logger.js';
import {
  PAYSTACK_ENDPOINTS,
  ERROR_MESSAGES,
  PAYMENT_LIMITS
} from '../../constants/payment.constants.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(message, statusCode = 500, code = null, data = null) {
    super(message);
    this.name = 'PaystackError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new PaystackError('PAYSTACK_SECRET_KEY not configured', 500, 'CONFIG_ERROR');
  }
  return key;
}

async function paystackRequest(endpoint, options = {}) {
  const secretKey = getSecretKey();
  
  const url = `${PAYSTACK_BASE_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    ...options.headers
  };
  
  try {
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.status) {
      logError('Paystack API Error', {
        endpoint,
        status: response.status,
        message: data.message,
        data: data.data
      });
      
      throw new PaystackError(
        data.message || ERROR_MESSAGES.PAYSTACK_API_ERROR,
        response.status,
        'API_ERROR',
        data
      );
    }
    
    return data;
  } catch (error) {
    if (error instanceof PaystackError) {
      throw error;
    }
    
    logError('Paystack Request Failed', {
      endpoint,
      error: error.message
    });
    
    throw new PaystackError(
      ERROR_MESSAGES.PAYSTACK_API_ERROR,
      500,
      'REQUEST_FAILED',
      { originalError: error.message }
    );
  }
}

export async function initializeTransaction({
  email,
  amount,
  reference,
  callback_url,
  metadata = {},
  channels,
  first_name,
  last_name,
  phone
}) {
  if (!email || !amount || !reference) {
    throw new PaystackError('Email, amount, and reference are required', 400, 'VALIDATION_ERROR');
  }
  
  if (amount < PAYMENT_LIMITS.MIN_AMOUNT) {
    throw new PaystackError(ERROR_MESSAGES.AMOUNT_TOO_LOW, 400, 'VALIDATION_ERROR');
  }
  
  const payload = {
    email,
    amount,
    reference,
    currency: PAYMENT_LIMITS.DEFAULT_CURRENCY,
    metadata
  };
  
  if (callback_url) {
    payload.callback_url = callback_url;
  }
  
  if (channels && channels.length > 0) {
    payload.channels = channels;
  }

  // Paystack shows these on the transaction and on the customer record, so the
  // dashboard reads as a person rather than a bare email and a reference.
  if (first_name) payload.first_name = first_name;
  if (last_name) payload.last_name = last_name;
  if (phone) payload.phone = phone;

  const response = await paystackRequest(PAYSTACK_ENDPOINTS.INITIALIZE, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  logInfo('[Paystack] Transaction initialized', {
    reference
  });
  
  return {
    authorization_url: response.data.authorization_url,
    access_code: response.data.access_code,
    reference: response.data.reference
  };
}

/**
 * Verify a payment transaction
 * 
 * Confirms the status of a transaction using its reference.
 * 
 * @param {string} reference - Transaction reference
 * @returns {Promise<Object>} Transaction details
 */
export async function verifyTransaction(reference) {
  if (!reference) {
    throw new PaystackError('Reference is required', 400, 'VALIDATION_ERROR');
  }
  
  const response = await paystackRequest(
    `${PAYSTACK_ENDPOINTS.VERIFY}/${encodeURIComponent(reference)}`,
    { method: 'GET' }
  );
  
  const data = response.data;
  
  logInfo('[Paystack] Transaction verified', {
    reference,
    status: data.status,
    amount: data.amount
  });
  
  return {
    id: data.id,
    reference: data.reference,
    status: data.status,  // success, failed, abandoned
    amount: data.amount,
    currency: data.currency,
    channel: data.channel,
    paid_at: data.paid_at,
    customer: {
      id: data.customer?.id,
      email: data.customer?.email,
      customer_code: data.customer?.customer_code
    },
    authorization: data.authorization ? {
      authorization_code: data.authorization.authorization_code,
      card_type: data.authorization.card_type,
      last4: data.authorization.last4,
      exp_month: data.authorization.exp_month,
      exp_year: data.authorization.exp_year,
      bank: data.authorization.bank,
      reusable: data.authorization.reusable
    } : null,
    metadata: data.metadata || {}
  };
}

/**
 * Charge a previously authorized payment method
 * 
 * Used for recurring payments (subscriptions).
 * 
 * @param {Object} options - Charge options
 * @param {string} options.authorization_code - Authorization code from previous payment
 * @param {string} options.email - Customer email
 * @param {number} options.amount - Amount in kobo
 * @param {string} options.reference - Unique transaction reference
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {Promise<Object>} Charge result
 */
export async function chargeAuthorization({
  authorization_code,
  email,
  amount,
  reference,
  metadata = {}
}) {
  if (!authorization_code || !email || !amount || !reference) {
    throw new PaystackError(
      'Authorization code, email, amount, and reference are required',
      400,
      'VALIDATION_ERROR'
    );
  }
  
  const payload = {
    authorization_code,
    email,
    amount,
    reference,
    currency: PAYMENT_LIMITS.DEFAULT_CURRENCY,
    metadata
  };
  
  const response = await paystackRequest(PAYSTACK_ENDPOINTS.CHARGE_AUTHORIZATION, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  const data = response.data;
  
  logInfo('[Paystack] Authorization charged', {
    reference,
    status: data.status,
    amount: data.amount
  });
  
  return {
    id: data.id,
    reference: data.reference,
    status: data.status,
    amount: data.amount,
    paid_at: data.paid_at,
    channel: data.channel,
    authorization: data.authorization
  };
}

/**
 * List transactions with optional filters
 * 
 * @param {Object} options - Filter options
 * @param {number} [options.perPage] - Records per page
 * @param {number} [options.page] - Page number
 * @param {string} [options.customer] - Customer ID or email
 * @param {string} [options.status] - Transaction status
 * @param {string} [options.from] - Start date (YYYY-MM-DD)
 * @param {string} [options.to] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Transaction list with pagination
 */
export async function listTransactions(options = {}) {
  const queryParams = new URLSearchParams();
  
  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);
  if (options.customer) queryParams.append('customer', options.customer);
  if (options.status) queryParams.append('status', options.status);
  if (options.from) queryParams.append('from', options.from);
  if (options.to) queryParams.append('to', options.to);
  
  const queryString = queryParams.toString();
  const endpoint = queryString 
    ? `${PAYSTACK_ENDPOINTS.LIST_TRANSACTIONS}?${queryString}`
    : PAYSTACK_ENDPOINTS.LIST_TRANSACTIONS;
  
  const response = await paystackRequest(endpoint, { method: 'GET' });
  
  return {
    transactions: response.data,
    meta: response.meta
  };
}

/**
 * Create a refund for a transaction
 * 
 * @param {Object} options - Refund options
 * @param {string} options.transaction - Transaction reference or ID
 * @param {number} [options.amount] - Amount to refund (optional, full refund if not provided)
 * @param {string} [options.reason] - Reason for refund
 * @returns {Promise<Object>} Refund details
 */
export async function createRefund({ transaction, amount, reason }) {
  if (!transaction) {
    throw new PaystackError('Transaction reference is required', 400, 'VALIDATION_ERROR');
  }
  
  const payload = { transaction };
  
  if (amount) payload.amount = amount;
  if (reason) payload.merchant_note = reason;
  
  const response = await paystackRequest(PAYSTACK_ENDPOINTS.REFUND, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  logInfo('[Paystack] Refund created', {
    transaction,
    amount: amount || 'full'
  });
  
  return response.data;
}

/**
 * Verify Paystack webhook signature
 * 
 * CRITICAL: Always verify webhook signatures to prevent fraud.
 * 
 * @param {string|Object} payload - Raw request body (string or parsed object)
 * @param {string} signature - x-paystack-signature header
 * @returns {boolean} True if signature is valid
 */
export function verifyWebhookSignature(payload, signature) {
  if (!signature) {
    logWarn('[Paystack] Missing webhook signature');
    return false;
  }
  
  const secretKey = getSecretKey();
  
  // Payload should be the raw body string for accurate hashing
  const payloadString = typeof payload === 'string' 
    ? payload 
    : JSON.stringify(payload);
  
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(payloadString)
    .digest('hex');

  const expected = Buffer.from(hash, 'hex');
  const received = Buffer.from(signature, 'hex');
  if (expected.length !== received.length) {
    logWarn('[Paystack] Invalid webhook signature length');
    return false;
  }

  const isValid = crypto.timingSafeEqual(expected, received);
  
  if (!isValid) {
    logWarn('[Paystack] Invalid webhook signature');
  }
  
  return isValid;
}

/**
 * Parse Paystack webhook event
 * 
 * @param {Object} payload - Webhook payload
 * @returns {Object} Parsed event data with event ID
 */
export function parseWebhookEvent(payload) {
  // express.raw() gives us a Buffer — parse it before accessing properties
  const body = Buffer.isBuffer(payload)
    ? JSON.parse(payload.toString('utf8'))
    : payload;

  if (!body || !body.event || !body.data) {
    throw new PaystackError('Invalid webhook payload', 400, 'INVALID_PAYLOAD');
  }
  
  // Paystack webhook event ID generation for replay protection
  // Paystack may include event ID in payload.id, but if not, generate deterministic ID
  // Use reference + event type as composite key (Paystack may send same event multiple times)
  // Adding timestamp ensures uniqueness while still allowing detection of exact duplicates
  let eventId = body.id;
  
  if (!eventId && body.data?.reference) {
    // Generate deterministic event ID from reference + event type
    // This allows us to detect duplicate webhooks even if Paystack doesn't provide event ID
    // Using hash ensures same reference + event always generates same ID for replay detection
    const eventData = `${body.data.reference}-${body.event}`;
    eventId = `evt_${crypto.createHash('sha256').update(eventData).digest('hex').substring(0, 16)}`;
  }
  
  return {
    event: body.event,
    data: body.data,
    eventId: eventId
  };
}

/**
 * Check if Paystack is properly configured
 * 
 * @returns {boolean} True if configured
 */
export function isConfigured() {
  return !!(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY);
}

/**
 * Get public key (safe to expose to frontend)
 * 
 * @returns {string} Paystack public key
 */
export function getPublicKey() {
  const key = process.env.PAYSTACK_PUBLIC_KEY;
  if (!key) {
    throw new PaystackError('PAYSTACK_PUBLIC_KEY not configured', 500, 'CONFIG_ERROR');
  }
  return key;
}

