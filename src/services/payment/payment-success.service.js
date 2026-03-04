import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import { formatAmount } from '../../utils/paymentHelpers.js';
import { activateSubscription } from './subscription.service.js';
import { createInAppNotification } from '../../services/notification.service.js';
import { sendPaymentSuccessEmail } from '../../services/email/paymentEmail.service.js';

export class PaymentSuccessService {
  static async processPaymentSuccessSideEffects({ transaction, gatewayData, order }) {
    const supabaseAdmin = getSupabaseAdmin();
    
    try {
      let car = null;
      if (transaction.car_id) {
        const { data: carRow, error: carError } = await supabaseAdmin
          .from('cars')
          .select('*')
          .eq('id', transaction.car_id)
          .single();
        if (carError) {
          logError('Failed to fetch car for notifications', {
            error: carError,
            carId: transaction.car_id,
            reference: transaction.reference
          });
        } else {
          car = carRow;
        }
      }
      
      const metadata = typeof transaction.metadata === 'string' 
        ? JSON.parse(transaction.metadata) 
        : (transaction.metadata || {});
      
      const isSubscription = metadata.subscription_id || metadata.is_subscription;
      const paymentType = metadata.payment_type || 'renewal_manual';

      if (order?.order_number) {
        logInfo('[Payment Success] Order created', { orderNumber: order.order_number });
      } else {
        logError('No order found for transaction', { reference: transaction.reference });
      }
      
      if (isSubscription && metadata.subscription_id && gatewayData?.authorization) {
        await this._activateSubscription(metadata.subscription_id, gatewayData.authorization, transaction.reference);
      }
      
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('email, first_name, user_id')
        .eq('id', transaction.user_id)
        .single();
      
      if (profileError || !profile?.email) {
        logError('Failed to fetch profile for notifications', {
          error: profileError,
          userId: transaction.user_id,
          reference: transaction.reference
        });
        return;
      }
      
      const scheduleIds = Array.isArray(metadata?.paymentScheduleId)
        ? metadata.paymentScheduleId
        : metadata?.paymentScheduleId ? [metadata.paymentScheduleId] : [];

      const formatScheduleName = (id) =>
        String(id).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const documentNames = scheduleIds.length > 0
        ? scheduleIds.map(formatScheduleName)
        : null;

      await Promise.all([
        this._sendEmailNotification({
          email: profile.email,
          firstName: profile.first_name || 'User',
          amount: transaction.amount,
          reference: transaction.reference,
          orderNumber: order?.order_number,
          carDetails: car,
          documentNames,
          paymentType
        }),
        this._sendInAppNotification({
          userId: transaction.user_id,
          amount: transaction.amount,
          orderNumber: order?.order_number,
          documentNames,
          paymentType
        })
      ]);
      
    } catch (error) {
      logError('Process payment success side-effects error', {
        error,
        reference: transaction.reference,
        transactionId: transaction.id,
        stack: error.stack
      });
      throw error;
    }
  }

  static async _activateSubscription(subscriptionId, authorization, reference) {
    try {
      await activateSubscription(
        subscriptionId,
        authorization.authorization_code,
        {
          card_type: authorization.card_type,
          last4: authorization.last4,
          exp_month: authorization.exp_month,
          exp_year: authorization.exp_year,
          bank: authorization.bank
        }
      );
      logInfo('[Payment Success] Subscription activated', { subscriptionId });
    } catch (subError) {
      logError('Failed to activate subscription', {
        error: subError,
        subscriptionId,
        reference
      });
    }
  }

  static async _sendEmailNotification({ email, firstName, amount, reference, orderNumber, carDetails, documentNames, paymentType }) {
    try {
      logInfo('[Payment Success] Attempting to send email', { email, reference, orderNumber });
      const result = await sendPaymentSuccessEmail({
        to: email,
        firstName,
        amount,
        reference,
        orderNumber: orderNumber || null,
        carDetails,
        documentNames,
        paymentType
      });
      logInfo('[Payment Success] Email sent successfully', { email, reference, emailId: result?.id });
    } catch (emailError) {
      logError('Failed to send payment success email', {
        error: emailError.message,
        email,
        reference
      });
    }
  }

  static async _sendInAppNotification({ userId, amount, orderNumber, documentNames, paymentType }) {
    try {
      const docPart = documentNames?.length > 0 ? ` for ${documentNames.join(', ')}` : '';
      const isPlateNumber = paymentType === 'plate_number';
      const isDriverLicense = paymentType === 'driver_license';
      const productLabel = isDriverLicense ? 'driver\'s license' : isPlateNumber ? 'plate number application' : 'renewal';
      const message = orderNumber
        ? `Payment of ${formatAmount(amount)} successful${docPart}! Order ${orderNumber} created for your ${productLabel}.`
        : `Payment of ${formatAmount(amount)} successful${docPart}! Your ${productLabel} is being processed.`;
      
      await createInAppNotification(
        userId,
        'payment',
        'payment_success',
        message
      );
      logInfo('[Payment Success] In-app notification created', { userId });
    } catch (notifError) {
      logError('Failed to create in-app notification', {
        error: notifError,
        userId
      });
    }
  }
}
