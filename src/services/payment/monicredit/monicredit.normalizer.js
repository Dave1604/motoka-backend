import { logInfo, logWarn } from '../../../utils/logger.js';

/**
 * Normalises raw Monicredit API responses into a stable internal shape.
 *
 * Monicredit's response schema varies across API versions and may differ
 * between sandbox and production environments. Field extraction uses a
 * priority-ordered list of candidate paths so the system remains resilient
 * to upstream schema changes without requiring code changes on each API update.
 *
 * Monetary values are always returned in kobo (the system's internal unit),
 * regardless of the Naira values returned by the Monicredit API.
 * `raw_response` is preserved on every normalised object for audit logging
 * and to facilitate debugging of field-mapping regressions.
 */
export class MonicreditNormalizer {
  /**
   * Normalises a transaction initialisation response.
   *
   * Virtual account details (account_number, bank_name, account_name) are
   * extracted from multiple candidate locations because Monicredit embeds
   * them differently depending on paytype and merchant configuration. A
   * warning is emitted when neither bank account details nor a payment URL
   * are present — this typically signals a merchant configuration problem
   * on the Monicredit side, not a code defect.
   *
   * @param {Object} response - Raw Monicredit API response
   * @returns {Object} Normalised response with total_amount in kobo
   */
  static normalizeInitResponse(response) {
    const data = response.data || response;
    
    // Monicredit returns amounts in Naira; convert to kobo for internal consistency.
    const totalAmountInNaira = data.total_amount || 0;
    const totalAmountInKobo = Math.round(totalAmountInNaira * 100);
    
    const normalized = {
      order_id: this._extractField(data, ['orderid', 'order_id']) || response.order_id,
      transaction_id: this._extractField(data, ['transid', 'transaction_id', 'id']),
      customer: data.customer || {},
      total_amount: totalAmountInKobo,
      
      account_number: this._extractField(data, [
        'customer.account_number',
        'account_number',
        'accountNumber',
        'virtual_account_number'
      ]),
      bank_name: this._extractField(data, [
        'customer.bank_name',
        'bank_name',
        'bankName',
        'virtual_bank'
      ]),
      account_name: this._extractField(data, [
        'customer.account_name',
        'account_name',
        'accountName',
        'account_holder'
      ]),
      
      payment_url: this._extractField(data, [
        'payment_url',
        'checkout_url',
        'url'
      ]),
      checkout_url: this._extractField(data, [
        'checkout_url',
        'payment_url',
        'url'
      ]),
      
      expires_at: data.expires_at,
      raw_response: response
    };

    logInfo('[Monicredit] Transaction initialized', {
      order_id: normalized.order_id,
      transaction_id: normalized.transaction_id,
      total_amount_naira: totalAmountInNaira,
      total_amount_kobo: totalAmountInKobo,
      has_account_details: !!(normalized.account_number && normalized.bank_name && normalized.account_name),
      has_payment_url: !!normalized.payment_url,
    });

    if ((!normalized.account_number || !normalized.bank_name || !normalized.account_name) && !normalized.payment_url) {
      logWarn('[Monicredit] No payment options in API response — check merchant configuration');
    }

    return normalized;
  }

  /**
   * Normalises a transaction verification response.
   *
   * Callers must treat the returned `status` field as the canonical approval
   * signal. Amounts are converted from Naira to kobo so they can be compared
   * directly against `payment_transactions.amount` without further conversion.
   *
   * @param {Object} response - Raw Monicredit API response
   * @returns {Object} Normalised response with amount in kobo
   */
  static normalizeVerifyResponse(response) {
    const data = response.data || response;
    
    // Monicredit returns amounts in Naira; convert to kobo for comparison
    // against transaction records, which store amounts in kobo.
    const amountInNaira = data.amount || 0;
    const amountInKobo = Math.round(amountInNaira * 100);
    
    logInfo('[Monicredit] Verification response normalized', {
      order_id: data.order_id || data.orderid,
      status: data.status,
      amount_naira: amountInNaira,
      amount_kobo: amountInKobo,
    });
    
    return {
      transaction_id: data.transaction_id,
      order_id: data.order_id || data.orderid,
      status: data.status,
      amount: amountInKobo,
      currency: data.currency || 'NGN',
      date_paid: data.date_paid,
      channel: data.channel,
      customer: data.customer,
      items: data.items,
      raw_response: response
    };
  }

  /**
   * Returns the first non-null value found by traversing `obj` using each
   * path in `paths` in priority order. Used to handle field name variance
   * across Monicredit API response versions.
   *
   * @param {Object} obj
   * @param {string[]} paths - Dot-notation paths in priority order
   * @returns {*} First resolved non-null value, or null
   */
  static _extractField(obj, paths) {
    for (const path of paths) {
      const value = this._getNestedValue(obj, path);
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return null;
  }

  /**
   * Traverses `obj` along a dot-notation path, returning undefined if any
   * segment in the chain is absent.
   *
   * @param {Object} obj
   * @param {string} path - e.g. 'customer.account_number'
   * @returns {*}
   */
  static _getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => 
      current?.[key], obj
    );
  }
}
