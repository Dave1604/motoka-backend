import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError } from '../../utils/logger.js';

/**
 * Payment audit logging for compliance and debugging.
 * Events: init, verify, webhook_success, webhook_failed, refund, status_change
 */
export async function logPaymentAudit({
  eventType,
  transactionId = null,
  reference = null,
  userId = null,
  paymentGateway = null,
  amountKobo = null,
  statusBefore = null,
  statusAfter = null,
  metadata = {},
  ipAddress = null,
}) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('payment_audit_log').insert({
      event_type: eventType,
      transaction_id: transactionId,
      reference,
      user_id: userId,
      payment_gateway: paymentGateway,
      amount_kobo: amountKobo,
      status_before: statusBefore,
      status_after: statusAfter,
      metadata: typeof metadata === 'object' ? metadata : {},
      ip_address: ipAddress,
    });
  } catch (error) {
    logError('Payment audit log failed', { error: error.message, eventType, reference });
    // Do not throw - audit failure should not break payment flow
  }
}
