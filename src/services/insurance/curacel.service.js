// Raw HTTP client for Curacel Grow. Mirrors the shape of
// services/payment/paystack.service.js: a base URL, a typed error, a key
// resolved from env at call time, and one request helper everything goes
// through. Nothing above this file should know Curacel exists.
import { logError, logInfo, logWarn } from '../../utils/logger.js';
import {
  CURACEL_BASE_URL,
  CURACEL_ENDPOINTS,
  INSURANCE_ERROR_MESSAGES
} from '../../constants/insurance.constants.js';

export class CuracelError extends Error {
  constructor(message, statusCode = 500, code = null, data = null) {
    super(message);
    this.name = 'CuracelError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

// Sandbox unless explicitly switched. Defaulting the other way risks a
// misconfigured deploy writing real policies against real money.
function getBaseUrl() {
  const env = process.env.CURACEL_ENV === 'production' ? 'production' : 'sandbox';
  return CURACEL_BASE_URL[env];
}

function getApiKey() {
  const key = process.env.CURACEL_API_KEY;
  if (!key) {
    throw new CuracelError(INSURANCE_ERROR_MESSAGES.NOT_CONFIGURED, 500, 'CONFIG_ERROR');
  }
  return key;
}

async function curacelRequest(endpoint, options = {}) {
  const url = `${getBaseUrl()}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers
  };

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    // Network-level failure — provider unreachable rather than a rejection.
    logError('Curacel request failed to send', { endpoint, error: err.message });
    throw new CuracelError(
      INSURANCE_ERROR_MESSAGES.PROVIDER_UNAVAILABLE,
      503,
      'NETWORK_ERROR'
    );
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body on an error status is common (HTML error pages, proxy
      // timeouts). Keep the raw text for the log rather than throwing on parse.
      body = { raw: text };
    }
  }

  if (!response.ok) {
    logError('Curacel returned an error', {
      endpoint,
      status: response.status,
      body
    });
    throw new CuracelError(
      body?.message || `Curacel request failed (${response.status})`,
      response.status,
      body?.code || 'PROVIDER_ERROR',
      body
    );
  }

  return body;
}

/**
 * List available insurance products. Used to discover the motor product IDs
 * this account is entitled to sell — those IDs differ per partner, so they are
 * fetched rather than hardcoded.
 */
export async function listProducts() {
  return curacelRequest(CURACEL_ENDPOINTS.PRODUCTS, { method: 'GET' });
}

/**
 * Create (or upsert) the customer the policy will belong to.
 *
 * @param {Object} customer
 * @param {string} customer.email
 * @param {string} customer.firstName
 * @param {string} customer.lastName
 * @param {string} [customer.phone]
 */
export async function createCustomer({ email, firstName, lastName, phone }) {
  return curacelRequest(CURACEL_ENDPOINTS.CUSTOMERS, {
    method: 'POST',
    body: JSON.stringify({
      email,
      first_name: firstName,
      last_name: lastName,
      phone
    })
  });
}

/**
 * Request a premium quotation for a vehicle. Read-only and free — safe to call
 * on page load so the customer sees a real price rather than an estimate.
 *
 * @param {Object} params
 * @param {string} params.productId - Curacel product to quote against
 * @param {Object} params.vehicle - registration, make, model, year, value
 * @param {string} [params.customerId]
 */
export async function createQuotation({ productId, vehicle, customerId }) {
  logInfo('Requesting Curacel quotation', {
    productId,
    registration: vehicle?.registrationNumber
  });

  return curacelRequest(CURACEL_ENDPOINTS.QUOTATIONS, {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      customer_id: customerId,
      vehicle: {
        registration_number: vehicle.registrationNumber,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        // Only meaningful for comprehensive; third-party premium is fixed by
        // NAICOM and does not vary with vehicle value.
        value: vehicle.value
      }
    })
  });
}

/**
 * Convert an accepted quotation into a paid order, which is what actually
 * issues the policy.
 *
 * Money has already moved on our side before this is called — see
 * insurance.service.js. If this throws after payment, the caller is
 * responsible for leaving the policy in a retryable state rather than
 * silently swallowing it.
 */
export async function createOrder({ quotationId, customerId, metadata = {} }) {
  logInfo('Creating Curacel order', { quotationId, customerId });

  return curacelRequest(CURACEL_ENDPOINTS.ORDERS, {
    method: 'POST',
    body: JSON.stringify({
      quotation_id: quotationId,
      customer_id: customerId,
      metadata
    })
  });
}

/**
 * Fetch a policy by provider reference. Used to reconcile state when a webhook
 * is missed — never rely solely on the webhook arriving.
 */
export async function getPolicy(policyReference) {
  return curacelRequest(`${CURACEL_ENDPOINTS.POLICIES}/${policyReference}`, {
    method: 'GET'
  });
}

/**
 * True when the provider is configured well enough to call. Lets routes stay
 * dark rather than 500 on every request in an environment without keys.
 */
export function isConfigured() {
  if (!process.env.CURACEL_API_KEY) {
    logWarn('Curacel is not configured — insurance endpoints will 404');
    return false;
  }
  return true;
}
