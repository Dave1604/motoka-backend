/**
 * Gateway Interface
 * 
 * Defines the common contract that all payment gateway adapters must implement.
 * This abstraction allows the system to work with multiple payment providers
 * through a unified interface, making it easy to add new gateways or switch
 * between providers.
 * 
 * All monetary amounts are in kobo (smallest currency unit).
 */

/**
 * Normalized payment initialization response
 * @typedef {Object} InitResponse
 * @property {string} reference - Internal transaction reference
 * @property {string} gateway_reference - Gateway-assigned reference/order ID
 * @property {number} amount - Amount in kobo
 * @property {string} currency - Currency code (e.g., 'NGN')
 * @property {string|null} authorization_url - Payment URL (if applicable)
 * @property {string|null} access_code - Access code (if applicable)
 * @property {string|null} account_number - Bank account number (if applicable)
 * @property {string|null} bank_name - Bank name (if applicable)
 * @property {string|null} account_name - Account name (if applicable)
 * @property {Date|string|null} expires_at - Payment expiration time
 */

/**
 * Normalized payment verification response
 * @typedef {Object} VerifyResponse
 * @property {boolean} success - Whether payment was successful
 * @property {string} status - Payment status ('success', 'pending', 'failed')
 * @property {number} amount - Amount in kobo
 * @property {string} currency - Currency code
 * @property {string} channel - Payment channel (e.g., 'card', 'bank_transfer')
 * @property {Date|string|null} paid_at - Payment timestamp
 * @property {Object|null} authorization - Authorization details (if applicable)
 */

/**
 * Health ping contract (implemented as a static `ping()` on each adapter).
 * Must prove the provider API is reachable AND our keys are accepted, using
 * a cheap read-only call — never moves money.
 *
 * @typedef {Object} PingResponse
 * @property {true} ok - Always true on success; throws otherwise
 * @property {number} latencyMs - Round-trip time in milliseconds
 */

/**
 * Gateway error base class
 */
export class GatewayError extends Error {
  constructor(message, statusCode = 500, code = null, data = null) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}
