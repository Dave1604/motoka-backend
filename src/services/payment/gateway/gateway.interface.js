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
 * Payment Gateway Interface
 * 
 * All gateway adapters must implement these methods to ensure consistent
 * behavior across different payment providers.
 */
export class GatewayInterface {
  /**
   * Initialize a payment transaction
   * 
   * @param {Object} params
   * @param {string} params.userId - User ID
   * @param {string} params.userEmail - User email
   * @param {Object} params.transaction - Internal transaction record
   * @param {Object} params.car - Car record
   * @param {string[]} params.paymentScheduleIds - Selected renewal item IDs
   * @param {number} params.renewalMonths - Renewal period in months
   * @param {string} params.paymentType - Payment type
   * @param {number} params.renewalAmount - Renewal amount in kobo
   * @param {number} params.deliveryFee - Delivery fee in kobo
   * @param {Object} params.deliveryData - Delivery details
   * @param {boolean} params.hasDeliveryDetails - Whether delivery is requested
   * @returns {Promise<InitResponse>} Normalized initialization response
   */
  async initializePayment(params) {
    throw new Error('initializePayment must be implemented by gateway adapter');
  }

  /**
   * Verify a payment transaction
   * 
   * @param {string} transactionId - Transaction reference or gateway order ID
   * @returns {Promise<VerifyResponse>} Normalized verification response
   */
  async verifyPayment(transactionId) {
    throw new Error('verifyPayment must be implemented by gateway adapter');
  }

  /**
   * Process a webhook event
   * 
   * @param {Object} webhookPayload - Raw webhook payload
   * @returns {Promise<Object>} Normalized webhook data
   */
  async processWebhook(webhookPayload) {
    throw new Error('processWebhook must be implemented by gateway adapter');
  }

  /**
   * Verify webhook signature
   * 
   * @param {string|Buffer} payload - Raw webhook payload
   * @param {string} signature - Webhook signature header
   * @returns {Promise<boolean>} Whether signature is valid
   */
  async verifyWebhookSignature(payload, signature) {
    throw new Error('verifyWebhookSignature must be implemented by gateway adapter');
  }
}

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
