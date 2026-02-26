import crypto from 'crypto';
import { logError, logInfo, logWarn, logDebug } from '../../../utils/logger.js';
import { retryWithBackoff } from '../../../utils/retry.js';
import {
  ERROR_MESSAGES,
  PAYMENT_LIMITS
} from '../../../constants/payment.constants.js';

const MONICREDIT_BASE_URL = process.env.MONICREDIT_BASE_URL || 'https://live.backend.monicredit.com/api/v1';
const MONICREDIT_REQUEST_TIMEOUT_MS = parseInt(process.env.MONICREDIT_REQUEST_TIMEOUT_MS || '30000', 10);

/**
 * Typed error for Monicredit API failures.
 *
 * Carries an HTTP status code and a machine-readable `code` so callers can
 * distinguish configuration errors (CONFIG_ERROR), input validation failures
 * (VALIDATION_ERROR), upstream API rejections (API_ERROR), and network
 * failures (REQUEST_FAILED) without string-matching on message text.
 */
export class MonicreditError extends Error {
  constructor(message, statusCode = 500, code = null, data = null) {
    super(message);
    this.name = 'MonicreditError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

function getPublicKey() {
  const key = process.env.MONICREDIT_PUBLIC_KEY;
  if (!key) {
    throw new MonicreditError('MONICREDIT_PUBLIC_KEY not configured', 500, 'CONFIG_ERROR');
  }
  return key;
}

function getPrivateKey() {
  const key = process.env.MONICREDIT_PRIVATE_KEY;
  if (!key) {
    throw new MonicreditError('MONICREDIT_PRIVATE_KEY not configured', 500, 'CONFIG_ERROR');
  }
  return key;
}

/**
 * Internal HTTP transport for all Monicredit API calls.
 *
 * Normalises two distinct failure modes into a single MonicreditError so
 * callers deal with one error type regardless of how the upstream signals
 * failure:
 *   1. Non-2xx HTTP responses — network or server-level errors.
 *   2. 200 OK responses where the envelope carries `status: false` or
 *      `success: false` — Monicredit's pattern for domain-level rejections
 *      such as duplicate order IDs or invalid revenue head codes.
 *
 * A resolved promise always represents a structurally valid, affirmatively
 * successful API response.
 */
async function monicreditRequest(endpoint, options = {}) {
  const url = `${MONICREDIT_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...options.headers
  };
  
  // Create abort signal with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, MONICREDIT_REQUEST_TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
    
    // Clear timeout on successful response
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    if (!response.ok) {
      logError('Monicredit API Error', {
        endpoint,
        status: response.status,
        message: data.message || data.error || 'Unknown error',
        data: data.data || data
      });
      
      throw new MonicreditError(
        data.message || data.error || ERROR_MESSAGES.MONICREDIT_API_ERROR,
        response.status,
        'API_ERROR',
        data
      );
    }
    
    // Monicredit uses 200 for domain-level rejections (e.g. duplicate
    // reference, invalid configuration). Inspect the envelope before returning.
    if (data.status === false || (data.success === false)) {
      logError('Monicredit API Error', {
        endpoint,
        status: response.status,
        message: data.message || 'Request failed',
        data: data.data || data
      });
      
      throw new MonicreditError(
        data.message || ERROR_MESSAGES.MONICREDIT_API_ERROR,
        response.status,
        'API_ERROR',
        data
      );
    }
    
    return data;
  } catch (error) {
    // Clear timeout if still set
    clearTimeout(timeoutId);
    
    if (error instanceof MonicreditError) {
      throw error;
    }
    
    // Handle timeout errors
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      logError('Monicredit Request Timeout', {
        endpoint,
        timeout_ms: MONICREDIT_REQUEST_TIMEOUT_MS,
        url
      });
      
      throw new MonicreditError(
        `Request timeout after ${MONICREDIT_REQUEST_TIMEOUT_MS}ms`,
        504,
        'REQUEST_TIMEOUT',
        { endpoint, timeout_ms: MONICREDIT_REQUEST_TIMEOUT_MS }
      );
    }
    
    logError('Monicredit Request Failed', {
      endpoint,
      error: error.message,
      errorName: error.name
    });
    
    throw new MonicreditError(
      ERROR_MESSAGES.MONICREDIT_API_ERROR,
      500,
      'REQUEST_FAILED',
      { originalError: error.message }
    );
  }
}

/**
 * Initiates a Monicredit payment transaction.
 *
 * Constraints:
 * - `total_amount` and all `items[].unit_cost` values must be in Naira.
 *   Monicredit's API does not accept kobo. The caller is responsible for
 *   converting from the system's internal kobo representation before invoking.
 * - `order_id` must be globally unique per merchant account. Reusing a
 *   reference causes a 200-level domain rejection from the API.
 * - The public key is injected server-side and must never be forwarded to
 *   client responses. It is redacted in all structured log output.
 * - `fee_bearer: 'merchant'` means transaction fees are absorbed by the
 *   platform and not added to the customer-facing total.
 *
 * @param {Object} options
 * @param {string} options.order_id - Unique transaction reference (our internal reference)
 * @param {Object} options.customer - Payer identity fields
 * @param {string} options.customer.email - Required; used for receipt delivery
 * @param {string} options.customer.first_name - Required by Monicredit
 * @param {string} options.customer.last_name - Required by Monicredit
 * @param {string} [options.customer.phone]
 * @param {string} [options.customer.nin] - Included when present in user profile
 * @param {Array<{unit_cost: number, item: string, revenue_head_code: string}>} options.items - Amounts in Naira
 * @param {number} options.total_amount - Total in Naira; should equal sum of items
 * @param {Object} [options.meta_data] - Arbitrary key-value context stored against the transaction
 * @returns {Promise<Object>} Raw Monicredit API response — pass through MonicreditNormalizer before use
 */
export async function initializeTransaction({
  order_id,
  customer,
  items,
  total_amount,
  meta_data = {},
  currency = 'NGN',
  paytype = 'inline',
  payment_methods,
  fee_bearer = 'merchant'
}) {
  if (!order_id || !customer || !items || !total_amount) {
    throw new MonicreditError(
      'Order ID, customer, items, and total amount are required',
      400,
      'VALIDATION_ERROR'
    );
  }
  
  // MIN_AMOUNT is stored in kobo system-wide; convert to Naira for this API boundary.
  const minAmountInNaira = PAYMENT_LIMITS.MIN_AMOUNT / 100;
  if (total_amount < minAmountInNaira) {
    throw new MonicreditError(ERROR_MESSAGES.AMOUNT_TOO_LOW, 400, 'VALIDATION_ERROR');
  }
  
  if (!customer.email || !customer.first_name || !customer.last_name) {
    throw new MonicreditError(
      'Customer email, first name, and last name are required',
      400,
      'VALIDATION_ERROR'
    );
  }
  
  const publicKey = getPublicKey();
  
  const payload = {
    order_id,
    public_key: publicKey,
    customer: {
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone: customer.phone || '',
      ...(customer.nin && { nin: customer.nin })
    },
    items: Array.isArray(items) ? items : [],
    currency,
    paytype,
    total_amount,
    fee_bearer,
    ...(payment_methods && payment_methods.length > 0 && { payment_methods }),
    ...(Object.keys(meta_data).length > 0 && { meta_data })
  };
  
  logDebug('[Monicredit] Initializing transaction', {
    endpoint: '/payment/transactions/init-transaction',
    order_id: payload.order_id,
    total_amount: payload.total_amount,
    currency: payload.currency,
    items_count: payload.items?.length || 0
  });
  
  // Wrap API call with retry logic for transient failures
  const response = await retryWithBackoff(
    () => monicreditRequest('/payment/transactions/init-transaction', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    {
      context: 'Monicredit initializeTransaction',
      maxRetries: 3,
      initialDelay: 1000
    }
  );
  
  logInfo('[Monicredit] Transaction initialized successfully', {
    order_id: payload.order_id,
    transaction_id: response.data?.transaction_id || response.transaction_id
  });
  
  return response;
}

/**
 * Verifies the current status of a Monicredit transaction.
 *
 * Uses the private key (server-side only) to authenticate the request.
 * This function must never be called from client-accessible code paths.
 * Returns the raw API response — pass through MonicreditNormalizer before
 * consuming the result.
 *
 * @param {string} transaction_id - Monicredit order_id or transaction reference
 * @returns {Promise<Object>} Raw Monicredit API response
 */
export async function verifyTransaction(transaction_id) {
  if (!transaction_id) {
    throw new MonicreditError('Transaction ID is required', 400, 'VALIDATION_ERROR');
  }
  
  const privateKey = getPrivateKey();
  
  // Wrap API call with retry logic for transient failures
  const response = await retryWithBackoff(
    () => monicreditRequest('/payment/transactions/verify-transaction', {
      method: 'POST',
      body: JSON.stringify({
        transaction_id,
        private_key: privateKey
      })
    }),
    {
      context: 'Monicredit verifyTransaction',
      maxRetries: 3,
      initialDelay: 1000
    }
  );
  
  logDebug('[Monicredit] Transaction verification completed', {
    transaction_id
  });
  
  return response;
}

/**
 * Returns true only when all three required environment variables are present.
 * Use as a startup health check or to gate gateway selection logic before
 * attempting to initialise a transaction.
 */
export function isConfigured() {
  return !!(
    process.env.MONICREDIT_BASE_URL &&
    process.env.MONICREDIT_PUBLIC_KEY &&
    process.env.MONICREDIT_PRIVATE_KEY
  );
}

/**
 * Exposes the Monicredit public key for scenarios that require client-side
 * SDK initialisation. The private key must never be exposed through this or
 * any other public-facing path.
 */
export function getPublicKeyValue() {
  return getPublicKey();
}

/**
 * Generates a deterministic event ID for Monicredit webhook events.
 * 
 * Monicredit may not provide explicit event IDs in webhook payloads, so we
 * generate deterministic IDs from the order_id and event type. This enables
 * replay attack protection by detecting duplicate webhook deliveries.
 * 
 * @param {string} orderId - Monicredit order ID (or transaction reference)
 * @param {string} eventType - Event type (e.g., 'payment.success', 'payment.failed')
 * @param {string} [transid] - Optional transaction ID for additional uniqueness
 * @returns {string} Deterministic event ID
 */
export function generateMonicreditEventId(orderId, eventType, transid = null) {
  if (!orderId || !eventType) {
    throw new MonicreditError('Order ID and event type are required for event ID generation', 400, 'VALIDATION_ERROR');
  }
  
  // Create composite key: order_id + event_type + optional transid
  // This ensures same order + event generates same ID for duplicate detection
  const eventData = transid 
    ? `${orderId}-${eventType}-${transid}`
    : `${orderId}-${eventType}`;
  
  // Generate deterministic hash (same input = same output)
  const hash = crypto.createHash('sha256').update(eventData).digest('hex').substring(0, 16);
  return `monicredit_evt_${hash}`;
}
