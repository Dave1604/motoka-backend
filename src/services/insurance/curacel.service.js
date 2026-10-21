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
 * List the products this partner account can sell. Motor product codes differ
 * per partner and per environment, so the caller matches on product_type.slug.
 * Paginated (15 per page); one page covers every partner we have seen.
 */
export async function listProducts() {
  const body = await curacelRequest(CURACEL_ENDPOINTS.PRODUCTS, { method: 'GET' });
  return body?.data ?? [];
}

/**
 * Find a customer by our own reference, or create them. Curacel keys customers
 * on the partner-supplied `ref` and refuses a duplicate with a 422, so this
 * reads first. Beyond name and contact, birth_date and residential_address are
 * mandatory on create.
 */
export async function ensureCustomer({ ref, email, firstName, lastName, phone, birthDate, address }) {
  try {
    const existing = await curacelRequest(`${CURACEL_ENDPOINTS.CUSTOMERS}/${encodeURIComponent(ref)}`, {
      method: 'GET'
    });
    if (existing?.data?.ref) return existing.data;
  } catch (err) {
    if (!(err instanceof CuracelError) || err.statusCode !== 404) throw err;
  }

  const created = await curacelRequest(CURACEL_ENDPOINTS.CUSTOMERS, {
    method: 'POST',
    body: JSON.stringify({
      ref,
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      birth_date: birthDate,
      residential_address: address
    })
  });
  return created?.data ?? created;
}

/**
 * Register a document (driver's licence) with Curacel from a URL we already
 * host. Returns the attachment id a quote must carry.
 */
export async function createAttachmentFromUrl({ fileUrl, description }) {
  const body = await curacelRequest(CURACEL_ENDPOINTS.ATTACHMENTS, {
    method: 'POST',
    body: JSON.stringify({ file_url: fileUrl, description })
  });
  return body?.attachment?.id ?? null;
}

/**
 * Price a motor policy. Curacel needs the full vehicle identity and the
 * driver's licence even to quote, so this is not a free "estimate" call —
 * the customer must already be registered and their licence attached.
 *
 * Returns Curacel's quote object: { id, ref, product_price, amount_due,
 * partner_commission, currency, policy_start_date }. product_price is what
 * the customer pays; amount_due is what Curacel deducts from our wallet.
 */
export async function createQuote({
  productCode,
  customerRef,
  policyStartDate,
  vehicle,
  driversLicenceNumber,
  driversLicenceAttachmentId,
  assetValue,
  assetRef
}) {
  logInfo('Requesting Curacel quote', { productCode, registration: vehicle?.registrationNumber });

  const payload = {
    product_code: productCode,
    customer_ref: customerRef,
    policy_start_date: policyStartDate,
    registration_number: vehicle.registrationNumber,
    vehicle_class: vehicle.vehicleClass,
    vehicle_make: vehicle.make,
    vehicle_model: vehicle.model,
    vehicle_year: vehicle.year,
    vehicle_color: vehicle.color,
    chassis_number: vehicle.chassisNumber,
    engine_number: vehicle.engineNumber,
    drivers_licence_number: driversLicenceNumber,
    drivers_licence_attachment_id: driversLicenceAttachmentId,
    asset_ref: assetRef
  };
  // Comprehensive premiums are a percentage of the vehicle's value; third-party
  // is a fixed NAICOM rate and Curacel ignores the field.
  if (assetValue != null) payload.asset_value = assetValue;

  const body = await curacelRequest(CURACEL_ENDPOINTS.QUOTES, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return body?.quote ?? null;
}

/**
 * Turn an accepted quote into an order, paid from our Curacel wallet. The
 * policy is issued synchronously when the wallet covers amount_due: the
 * response carries status "paid"/"policy_created" and the full policy is on
 * the order record.
 */
export async function acceptQuote({ quoteRef }) {
  logInfo('Accepting Curacel quote', { quoteRef });
  const body = await curacelRequest(CURACEL_ENDPOINTS.ACCEPT_QUOTE, {
    method: 'POST',
    body: JSON.stringify({ ref: quoteRef, payment_type: 'wallet' })
  });
  return body?.order ?? null;
}

/**
 * Fetch an order with its policy. Used right after acceptance (the accept
 * response omits the policy) and to reconcile a pending row later. There is no
 * webhook, so this is the only way a missed issuance is ever noticed.
 */
export async function getOrder(orderId) {
  const body = await curacelRequest(`${CURACEL_ENDPOINTS.ORDERS}/${orderId}`, { method: 'GET' });
  return body?.data ?? null;
}

export async function getPolicy(policyId) {
  const body = await curacelRequest(`${CURACEL_ENDPOINTS.POLICIES}/${policyId}`, { method: 'GET' });
  return body?.data ?? null;
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
