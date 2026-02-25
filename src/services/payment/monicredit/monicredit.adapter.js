import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../config/supabase.js';
import { getRenewalItems } from '../renewalItems.service.js';
import { initializeTransaction, verifyTransaction, generateMonicreditEventId, MonicreditError } from './monicredit.service.js';
import { MonicreditNormalizer } from './monicredit.normalizer.js';
import { sanitizeCustomerData } from '../validation/input.sanitizer.js';
import { logWarn, logDebug, logError } from '../../../utils/logger.js';
import { validateInitResponse, validateVerifyResponse, validateWebhookPayload } from '../validation/response.validator.js';

/**
 * Orchestrates Monicredit payment flows by bridging domain business logic
 * with the Monicredit HTTP service layer.
 *
 * Responsibilities:
 * - Resolves user profile, renewal items, and delivery data into a
 *   Monicredit-compatible payload.
 * - Converts all monetary values from kobo (system-internal unit) to Naira
 *   before handing off to monicredit.service.
 * - Delegates response normalisation to MonicreditNormalizer so callers
 *   receive a stable shape regardless of upstream API version changes.
 *
 * Assumption: all monetary amounts entering public methods are in kobo.
 */
export class MonicreditAdapter {
  /**
   * Builds and submits a payment initialisation request to Monicredit.
   *
   * The sum of line items is used as the authoritative `total_amount` rather
   * than the pre-calculated renewal total. Monicredit independently sums
   * line items server-side, and a mismatch between `total_amount` and
   * `sum(items[].unit_cost)` causes a domain-level API rejection. Discrepancies
   * between the two calculations are logged for monitoring but do not block
   * the request, since rounding across kobo-to-Naira conversions can produce
   * sub-kobo differences that are not financially meaningful.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.userEmail
   * @param {Object} params.transaction - Internal transaction record (must have `reference`)
   * @param {Object} params.car - Car record (id, slug, vehicle_make, vehicle_model, registration_no)
   * @param {string[]} params.paymentScheduleIds - Selected renewal item IDs
   * @param {number} params.renewalMonths
   * @param {string} params.paymentType
   * @param {number} params.renewalAmount - In kobo
   * @param {number} params.deliveryFee - In kobo; 0 when no delivery is requested
   * @param {Object} params.deliveryData - Raw delivery fields from the request body
   * @param {boolean} params.hasDeliveryDetails
   * @returns {Promise<Object>} Normalised init response from MonicreditNormalizer
   */
  static async initializePayment({
    userId,
    userEmail,
    transaction,
    car,
    paymentScheduleIds,
    renewalMonths,
    paymentType,
    renewalAmount,
    deliveryFee,
    deliveryData,
    hasDeliveryDetails
  }) {
    const profile = await this._getUserProfile(userId);
    const items = await this._buildPaymentItems(paymentScheduleIds, deliveryFee);
    
    // Validate items array is not empty
    if (!items || items.length === 0) {
      logError('[Monicredit] No payment items found', {
        transaction_reference: transaction.reference,
        paymentScheduleIds,
        deliveryFee
      });
      throw new MonicreditError(
        'No payment items selected. Please select at least one renewal item.',
        400,
        'VALIDATION_ERROR'
      );
    }
    
    const customerData = this._buildCustomerData(userEmail, profile);
    
    // Validate customer data before proceeding
    if (!customerData.email || !customerData.first_name?.trim() || !customerData.last_name?.trim()) {
      logError('[Monicredit] Invalid customer data', {
        transaction_reference: transaction.reference,
        has_email: !!customerData.email,
        has_first_name: !!customerData.first_name,
        has_last_name: !!customerData.last_name,
        userEmail,
        profile_exists: !!profile
      });
      throw new MonicreditError(
        'Customer information is incomplete. Please ensure your profile has first name, last name, and email.',
        400,
        'VALIDATION_ERROR'
      );
    }
    
    const metaData = this._buildMetadata({
      transaction,
      car,
      userId,
      renewalMonths,
      paymentType,
      paymentScheduleIds,
      renewalAmount,
      deliveryFee,
      deliveryData,
      hasDeliveryDetails
    });

    // Monicredit expects all monetary values in Naira. Convert items from kobo.
    const itemsInNaira = items.map(item => ({
      ...item,
      unit_cost: item.unit_cost / 100
    }));
    
    // Use the sum of line items as total_amount to guarantee alignment with
    // Monicredit's server-side calculation. Passing a mismatched total causes
    // a 200-level domain rejection. Sub-kobo differences from floating-point
    // rounding are expected and logged, not treated as errors.
    const itemsSum = itemsInNaira.reduce((sum, item) => sum + (item.unit_cost || 0), 0);
    const totalAmountInNaira = (renewalAmount + deliveryFee) / 100;
    
    const difference = Math.abs(itemsSum - totalAmountInNaira);
    if (difference > 0.01) {
      logWarn('[Monicredit] Items sum mismatch detected', {
        itemsSum,
        totalAmountInNaira,
        difference,
        transaction_reference: transaction.reference,
        items: itemsInNaira.map(i => ({ name: i.item, cost: i.unit_cost }))
      });
    }
    
    logDebug('[Monicredit] Amount calculation', {
      transaction_reference: transaction.reference,
      renewalAmount_kobo: renewalAmount,
      renewalAmount_naira: renewalAmount / 100,
      deliveryFee_kobo: deliveryFee,
      deliveryFee_naira: deliveryFee / 100,
      calculatedTotal_kobo: renewalAmount + deliveryFee,
      calculatedTotal_naira: totalAmountInNaira,
      itemsSum_naira: itemsSum,
      finalTotal_naira: itemsSum,
      itemsCount: itemsInNaira.length
    });
    
    try {
      logDebug('[Monicredit] Calling initializeTransaction', {
        order_id: transaction.reference,
        customer_email: customerData.email,
        customer_first_name: customerData.first_name,
        customer_last_name: customerData.last_name,
        items_count: itemsInNaira.length,
        total_amount: itemsSum,
        items: itemsInNaira.map(i => ({ name: i.item, cost: i.unit_cost }))
      });

      const response = await initializeTransaction({
        order_id: transaction.reference,
        customer: customerData,
        items: itemsInNaira,
        total_amount: itemsSum,
        paytype: 'inline',
        fee_bearer: 'merchant',
        meta_data: metaData
      });

      logDebug('[Monicredit] Raw API response received', {
        order_id: transaction.reference,
        response_keys: Object.keys(response),
        has_data: !!response.data,
        has_transaction_id: !!(response.data?.transaction_id || response.transaction_id)
      });

      const normalizedResponse = MonicreditNormalizer.normalizeInitResponse(response);
      
      logDebug('[Monicredit] Response normalized', {
        order_id: transaction.reference,
        normalized_keys: Object.keys(normalizedResponse),
        order_id_in_response: normalizedResponse.order_id,
        total_amount: normalizedResponse.total_amount
      });
      
      // Validate normalized response
      validateInitResponse({
        reference: transaction.reference,
        gateway_reference: normalizedResponse.order_id,
        amount: normalizedResponse.total_amount,
        currency: 'NGN'
      });
      
      return normalizedResponse;
    } catch (error) {
      logError('[Monicredit] Adapter initialization failed', {
        error: error.message,
        error_code: error.code,
        error_name: error.name,
        status_code: error.statusCode,
        transaction_reference: transaction.reference,
        customer_email: customerData.email,
        items_count: itemsInNaira.length,
        total_amount: itemsSum
      });
      throw error;
    }
  }

  /**
   * Verifies a Monicredit transaction via the private-key-authenticated
   * verify endpoint. Returns a normalised response; callers must inspect
   * the `status` field to determine whether the payment was approved.
   *
   * @param {string} transactionId - Monicredit order_id or transaction reference
   * @returns {Promise<Object>} Normalised verification response
   */
  static async verifyPayment(transactionId) {
    const response = await verifyTransaction(transactionId);
    const normalizedResponse = MonicreditNormalizer.normalizeVerifyResponse(response);
    
    // Validate normalized response
    validateVerifyResponse({
      success: normalizedResponse.status === 'approved' || normalizedResponse.status === 'success',
      status: normalizedResponse.status,
      amount: normalizedResponse.amount,
      currency: normalizedResponse.currency || 'NGN'
    });
    
    return normalizedResponse;
  }

  /**
   * Process a webhook event
   * 
   * Normalizes Monicredit webhook payloads which may have varying structures.
   * 
   * @param {Object} webhookPayload - Raw webhook payload
   * @returns {Promise<Object>} Normalized webhook data
   */
  static async processWebhook(webhookPayload) {
    // Validate webhook payload
    validateWebhookPayload(webhookPayload, 'monicredit');
    
    // Normalise both event-keyed and status-keyed payload shapes
    const event = webhookPayload.event || webhookPayload.type;
    const data = webhookPayload.data || webhookPayload;
    
    // Generate event ID for replay protection
    const orderId = data.order_id || data.transid || webhookPayload.order_id;
    const eventId = orderId ? generateMonicreditEventId(orderId, event || 'payment', data.transid) : null;
    
    return {
      event: event || (webhookPayload.status === 'success' || webhookPayload.status === 'approved' ? 'payment.success' : 'payment.failed'),
      eventId,
      data,
      gateway: 'monicredit'
    };
  }

  /**
   * Verify webhook signature
   * 
   * @param {string|Buffer} payload - Raw webhook payload
   * @param {string} signature - Webhook signature header
   * @returns {Promise<boolean>} Whether signature is valid
   */
  static async verifyWebhookSignature(payload, signature) {
    const webhookSecret = process.env.MONICREDIT_WEBHOOK_SECRET;
    
    if (!webhookSecret || !signature) {
      return false;
    }
    
    const payloadString = Buffer.isBuffer(payload) ? payload.toString('utf8') : (typeof payload === 'string' ? payload : JSON.stringify(payload));
    
    // Test SHA256 and SHA512 (Monicredit may use either)
    const expectedSHA256 = crypto.createHmac('sha256', webhookSecret).update(payloadString).digest('hex');
    const expectedSHA512 = crypto.createHmac('sha512', webhookSecret).update(payloadString).digest('hex');
    
    return (
      signature === expectedSHA256 ||
      signature === expectedSHA512 ||
      signature === `sha256=${expectedSHA256}` ||
      signature === `sha512=${expectedSHA512}`
    );
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Fetches the minimal profile fields required to satisfy Monicredit's
   * customer object. Returns null when no profile row exists; callers must
   * apply fallbacks (see _buildCustomerData).
   *
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  static async _getUserProfile(userId) {
    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, phone_number, nin')
      .eq('id', userId)
      .single();
    
    return profile;
  }

  /**
   * Builds the Monicredit line items array from the user's selected renewal
   * schedule entries plus an optional delivery fee line item.
   *
   * Amounts are returned in kobo (the system's internal unit). The caller
   * must convert to Naira before passing to the API.
   *
   * All items share a single revenue head code sourced from
   * MONICREDIT_REVENUE_HEAD_CODE. If that variable is unset, a hardcoded
   * fallback is used — this should be explicitly configured per environment
   * to avoid revenue misclassification in Monicredit's reconciliation system.
   *
   * @param {string[]} paymentScheduleIds
   * @param {number} deliveryFee - In kobo
   * @returns {Promise<Array<{unit_cost: number, item: string, revenue_head_code: string}>>}
   */
  static async _buildPaymentItems(paymentScheduleIds, deliveryFee) {
    const renewalItems = await getRenewalItems();
    const selectedItems = renewalItems.filter(item => 
      paymentScheduleIds.includes(item.id)
    );
    
    const revenueHeadCode = process.env.MONICREDIT_REVENUE_HEAD_CODE || 'REV68dff2878cb81';
    
    const items = selectedItems.map(item => ({
      unit_cost: item.price,
      item: item.name,
      revenue_head_code: revenueHeadCode
    }));
    
    if (deliveryFee > 0) {
      items.push({
        unit_cost: deliveryFee,
        item: 'Delivery Fee',
        revenue_head_code: revenueHeadCode
      });
    }
    
    return items;
  }

  /**
   * Constructs the Monicredit customer object from user profile data.
   *
   * Falls back to the email local-part as `first_name` when no profile
   * exists, satisfying Monicredit's required-field constraint without
   * blocking the transaction. NIN is conditionally included; Monicredit
   * treats it as optional but may use it for identity verification.
   *
   * @param {string} userEmail
   * @param {Object|null} profile
   * @returns {Object}
   */
  static _buildCustomerData(userEmail, profile) {
    const firstName = profile?.first_name || userEmail.split('@')[0];
    // Monicredit requires non-empty last_name — fall back to first_name if missing
    const lastName = (profile?.last_name && profile.last_name.trim()) ? profile.last_name.trim() : firstName;
    const customerData = {
      first_name: firstName,
      last_name: lastName,
      email: userEmail,
      phone: profile?.phone_number || ''
    };
    
    if (profile?.nin) {
      customerData.nin = profile.nin;
    }
    
    // PHASE 2: Sanitize all customer data before sending to Monicredit API
    // This prevents XSS and injection attacks
    return sanitizeCustomerData(customerData);
  }

  /**
   * Builds the metadata object attached to the Monicredit transaction.
   *
   * This data is opaque to Monicredit but is essential for internal
   * reconciliation: webhook handlers read it to determine renewal period,
   * selected items, and delivery requirements when creating orders on
   * payment confirmation. Delivery details are omitted when no delivery
   * address was supplied so handlers can reliably infer fulfilment type.
   *
   * @param {Object} params
   * @returns {Object}
   */
  static _buildMetadata({ 
    transaction, 
    car, 
    userId, 
    renewalMonths, 
    paymentType, 
    paymentScheduleIds, 
    renewalAmount, 
    deliveryFee, 
    deliveryData, 
    hasDeliveryDetails 
  }) {
    return {
      transaction_id: transaction.id,
      car_id: car.id,
      car_slug: car.slug,
      user_id: userId,
      renewal_months: renewalMonths,
      payment_type: paymentType,
      payment_schedule_id: paymentScheduleIds,
      renewal_amount: renewalAmount,
      delivery_fee: deliveryFee,
      delivery_details: hasDeliveryDetails ? deliveryData : null,
      vehicle: `${car.vehicle_make} ${car.vehicle_model}`,
      registration: car.registration_no || 'N/A'
    };
  }
}
