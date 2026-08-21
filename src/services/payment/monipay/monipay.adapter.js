import { getSupabaseAdmin } from '../../../config/supabase.js';
import {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  parseWebhookEvent,
  MonipayError,
} from './monipay.service.js';
import { validateInitResponse, validateVerifyResponse } from '../validation/response.validator.js';
import { logError } from '../../../utils/logger.js';

export class MonipayAdapter {
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
    licenseType,
    firstName,
    lastName,
    phone,
  }) {
    const amount = Math.trunc(Number(renewalAmount) + Number(deliveryFee || 0));
    const callbackUrl = process.env.MONIPAY_CALLBACK_URL
      || `${process.env.FRONTEND_URL}/payment/monipay/callback`;

    let profileName = { firstName, lastName, phone };
    if (userId && (!firstName || !lastName || !phone)) {
      const { data: profile } = await getSupabaseAdmin()
        .from('profiles')
        .select('first_name, last_name, phone_number, phone')
        .eq('id', userId)
        .maybeSingle();
      profileName = {
        firstName: firstName || profile?.first_name,
        lastName: lastName || profile?.last_name,
        phone: phone || profile?.phone_number || profile?.phone,
      };
    }

    const metadata = {
      transaction_id: transaction.id,
      order_id: String(transaction.id),
      car_id: car?.id ?? null,
      car_slug: car?.slug ?? null,
      user_id: userId,
      renewal_months: renewalMonths,
      payment_type: paymentType,
      payment_schedule_id: paymentScheduleIds,
      renewal_amount: renewalAmount,
      delivery_fee: deliveryFee,
      delivery_details: hasDeliveryDetails ? deliveryData : null,
      ...(licenseType ? { license_type: licenseType } : {}),
      ...(plateType ? { plate_type: plateType } : {}),
      ...(subType ? { sub_type: subType } : {}),
    };

    try {
      const result = await initializeTransaction({
        email: userEmail,
        amount,
        reference: transaction.reference,
        callback_url: callbackUrl,
        metadata,
        first_name: profileName.firstName,
        last_name: profileName.lastName,
        phone: profileName.phone,
      });

      const normalizedResponse = {
        reference: result.reference || transaction.reference,
        gateway_reference: result.reference || transaction.reference,
        amount,
        currency: 'NGN',
        authorization_url: result.authorization_url,
        access_code: result.access_code,
        account_number: null,
        bank_name: null,
        account_name: null,
        expires_at: null,
      };

      validateInitResponse(normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      logError('Monipay initialization error', {
        error: error.message,
        reference: transaction.reference,
        userId,
      });
      throw error;
    }
  }

  static async verifyPayment(transactionId) {
    try {
      const result = await verifyTransaction(transactionId);
      const normalizedResponse = {
        success: Boolean(result.success),
        status: result.status,
        amount: result.amount,
        currency: result.currency || 'NGN',
        channel: result.channel || null,
        paid_at: result.paid_at || null,
        authorization: result.authorization || null,
      };
      validateVerifyResponse(normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      logError('Monipay verification error', { error: error.message, transactionId });
      throw error;
    }
  }

  static async processWebhook(webhookPayload) {
    return parseWebhookEvent(webhookPayload);
  }

  static async verifyWebhookSignature(payload, signature) {
    return verifyWebhookSignature(payload, signature);
  }
}

export { MonipayError };
