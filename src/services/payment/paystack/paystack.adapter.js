import {
  initializeTransaction as paystackInitialize,
  verifyTransaction as paystackVerify,
  verifyWebhookSignature as paystackVerifySignature,
  parseWebhookEvent as paystackParseEvent,
  PaystackError
} from '../paystack.service.js';
import { validateInitResponse, validateVerifyResponse, validateWebhookPayload } from '../validation/response.validator.js';
import { buildPaymentMetadata } from '../../../utils/paymentHelpers.js';
import { logError, logDebug } from '../../../utils/logger.js';

/**
 * Paystack Gateway Adapter
 * 
 * Implements the gateway interface for Paystack payment provider.
 * Wraps the existing Paystack service functions and normalizes responses
 * to match the gateway interface contract.
 */
export class PaystackAdapter {
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
   * @returns {Promise<Object>} Normalized initialization response
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
    hasDeliveryDetails,
    plateType,
    subType,
    licenseType
  }) {
    const amount = renewalAmount + (deliveryFee || 0);

    const callbackUrl = process.env.PAYMENT_CALLBACK_URL ||
      `${process.env.FRONTEND_URL}/payment/paystack/callback`;

    const customFields = car
      ? [
          { display_name: 'Vehicle', variable_name: 'vehicle', value: `${car.vehicle_make || ''} ${car.vehicle_model || ''}`.trim() || 'N/A' },
          { display_name: 'Registration', variable_name: 'registration', value: car.registration_no || 'N/A' },
          ...(hasDeliveryDetails && deliveryData
            ? [
                { display_name: 'Delivery State', variable_name: 'delivery_state', value: deliveryData.state || '' },
                { display_name: 'Delivery LGA', variable_name: 'delivery_lga', value: deliveryData.lga || '' }
              ]
            : [])
        ]
      : (hasDeliveryDetails && deliveryData
        ? [
            { display_name: 'Delivery State', variable_name: 'delivery_state', value: deliveryData.state || '' },
            { display_name: 'Delivery LGA', variable_name: 'delivery_lga', value: deliveryData.lga || '' }
          ]
        : []);

    const metadata = {
      transaction_id: transaction.id,
      car_id: car?.id ?? null,
      car_slug: car?.slug ?? null,
      user_id: userId,
      renewal_months: renewalMonths,
      payment_type: paymentType,
      payment_schedule_id: paymentScheduleIds,
      renewal_amount: renewalAmount,
      delivery_fee: deliveryFee,
      delivery_details: hasDeliveryDetails ? deliveryData : null,
      custom_fields: customFields,
      ...(licenseType ? { license_type: licenseType } : {}),
      ...(plateType ? { plate_type: plateType } : {}),
      ...(subType ? { sub_type: subType } : {})
    };

    try {
      const paystackResult = await paystackInitialize({
        email: userEmail,
        amount,
        reference: transaction.reference,
        callback_url: callbackUrl,
        metadata
      });
      
      // Normalize response to match gateway interface
      const normalizedResponse = {
        reference: transaction.reference,
        gateway_reference: paystackResult.reference,
        amount: amount,
        currency: 'NGN',
        authorization_url: paystackResult.authorization_url,
        access_code: paystackResult.access_code,
        account_number: null,
        bank_name: null,
        account_name: null,
        expires_at: null
      };
      
      // Validate normalized response
      validateInitResponse(normalizedResponse);
      
      return normalizedResponse;
    } catch (error) {
      logError('Paystack initialization error', {
        error,
        reference: transaction.reference,
        userId
      });
      throw error;
    }
  }

  /**
   * Verify a payment transaction
   * 
   * @param {string} transactionId - Transaction reference
   * @returns {Promise<Object>} Normalized verification response
   */
  static async verifyPayment(transactionId) {
    try {
      const paystackResult = await paystackVerify(transactionId);
      
      // Normalize response to match gateway interface
      const isSuccess = paystackResult.status === 'success';
      
      const normalizedResponse = {
        success: isSuccess,
        status: isSuccess ? 'success' : paystackResult.status,
        amount: paystackResult.amount,
        currency: paystackResult.currency || 'NGN',
        channel: paystackResult.channel || null,
        paid_at: paystackResult.paid_at || null,
        authorization: paystackResult.authorization || null,
        raw_response: paystackResult // Include raw response for compatibility
      };
      
      // Validate normalized response
      validateVerifyResponse(normalizedResponse);
      
      return normalizedResponse;
    } catch (error) {
      logError('Paystack verification error', {
        error,
        transactionId
      });
      throw error;
    }
  }

  /**
   * Process a webhook event
   * 
   * @param {Object} webhookPayload - Raw webhook payload
   * @returns {Promise<Object>} Normalized webhook data
   */
  static async processWebhook(webhookPayload) {
    try {
      // Validate webhook payload
      validateWebhookPayload(webhookPayload, 'paystack');
      
      const parsed = paystackParseEvent(webhookPayload);
      
      return {
        event: parsed.event,
        eventId: parsed.eventId,
        data: parsed.data,
        gateway: 'paystack'
      };
    } catch (error) {
      logError('Paystack webhook processing error', {
        error,
        payload: webhookPayload
      });
      throw error;
    }
  }

  /**
   * Verify webhook signature
   * 
   * @param {string|Buffer} payload - Raw webhook payload
   * @param {string} signature - Webhook signature header
   * @returns {Promise<boolean>} Whether signature is valid
   */
  static async verifyWebhookSignature(payload, signature) {
    return paystackVerifySignature(payload, signature);
  }
}

// Export PaystackError for compatibility
export { PaystackError };
