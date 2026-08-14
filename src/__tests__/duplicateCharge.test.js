import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Duplicate-charge guard.
 *
 * Context: on 2026-05-14 one customer was charged 3× ₦5,000 within 90 seconds for
 * a single ₦5,000 renewal, across two gateways. Neither existing protection caught
 * it — the init-time guard only abandons *pending* rows, and the RPC's uniqueness
 * (`renewal_orders_transaction_unique`) is per transaction, so N distinct
 * references for one car each pass.
 *
 * The guard must never reject the payment: the money has already left the
 * customer's account, so recording it is what makes a refund possible. What it
 * prevents is a SECOND order and a double expiry extension.
 */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({ rpc: mockRpc, from: mockFrom }),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn(), logDebug: jest.fn(),
}));
jest.unstable_mockModule('../services/payment/audit.service.js', () => ({
  logPaymentAudit: jest.fn(),
}));

const { processPaymentSuccess } = await import('../services/payment/transaction.service.js');

/** Minimal chainable stub mirroring the supabase-js builder surface we use. */
function builder(result) {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'gte', 'in', 'limit', 'update']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(async () => result);
  chain.single = jest.fn(async () => result);
  chain.then = (resolve) => Promise.resolve(result).then(resolve);
  return chain;
}

const PENDING_TX = {
  id: 259, reference: 'PAY-C', user_id: 'u1', car_id: 113,
  payment_type: 'renewal_manual', amount: 500000, status: 'pending',
};

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockRpc.mockResolvedValue({
    data: [{ transaction_id: 259, order_id: 77, already_processed: false }], error: null,
  });
});

describe('duplicate-charge guard', () => {
  it('blocks a second charge once the vehicle already has a fulfilling order', async () => {
    const updateChain = builder({ data: null, error: null });

    mockFrom.mockImplementation((table) => {
      if (table === 'payment_transactions') {
        // 1st call: look up this transaction. 2nd: sibling search. 3rd: the update.
        if (mockFrom.mock.calls.filter(c => c[0] === 'payment_transactions').length === 1) {
          return builder({ data: PENDING_TX, error: null });
        }
        if (mockFrom.mock.calls.filter(c => c[0] === 'payment_transactions').length === 2) {
          return builder({ data: [{ id: 258, reference: 'PAY-B', created_at: '2026-05-14T18:32:34Z' }], error: null });
        }
        return updateChain;
      }
      if (table === 'renewal_orders') {
        return builder({ data: { id: 77, order_number: 'ORD-20260515-270C94' }, error: null });
      }
      return builder({ data: null, error: null });
    });

    const result = await processPaymentSuccess({
      reference: 'PAY-C', status: 'successful', orderType: 'renewal',
    });

    // The order-creating RPC must NOT run — that is the whole point.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.duplicateCharge).toBe(true);
    expect(result.refundDue).toBe(true);
    expect(result.orderId).toBeNull();
    expect(result.fulfilledByOrder).toBe('ORD-20260515-270C94');

    // The money is still recorded as received, tagged for the refund worklist.
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'successful', cancellation_reason: 'duplicate_charge' })
    );

    // alreadyProcessed suppresses the "order confirmed" side effects at the caller.
    expect(result.alreadyProcessed).toBe(true);
  });

  it('lets a charge through when no order exists yet — it may be the only fulfilment', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'payment_transactions') {
        return mockFrom.mock.calls.filter(c => c[0] === 'payment_transactions').length === 1
          ? builder({ data: PENDING_TX, error: null })
          : builder({ data: [{ id: 257, reference: 'PAY-A', created_at: '2026-05-14T18:32:04Z' }], error: null });
      }
      if (table === 'renewal_orders') return builder({ data: null, error: null }); // no order yet
      return builder({ data: null, error: null });
    });

    const result = await processPaymentSuccess({
      reference: 'PAY-C', status: 'successful', orderType: 'renewal',
    });

    expect(mockRpc).toHaveBeenCalled();
    expect(result.duplicateCharge).toBeUndefined();
    expect(result.orderId).toBe(77);
  });

  it('ignores payments with no car (driver licence) rather than mis-flagging them', async () => {
    mockFrom.mockImplementation((table) =>
      table === 'payment_transactions'
        ? builder({ data: { ...PENDING_TX, car_id: null }, error: null })
        : builder({ data: null, error: null })
    );

    const result = await processPaymentSuccess({
      reference: 'PAY-DL', status: 'successful', orderType: 'driver_license',
    });

    expect(mockRpc).toHaveBeenCalled();
    expect(result.duplicateCharge).toBeUndefined();
  });

  it('does not engage on non-success statuses', async () => {
    mockFrom.mockImplementation(() => builder({ data: null, error: null }));

    await processPaymentSuccess({ reference: 'PAY-X', status: 'failed', orderType: 'renewal' });

    // No transaction lookup needed when the payment did not succeed.
    expect(mockFrom).not.toHaveBeenCalledWith('payment_transactions');
    expect(mockRpc).toHaveBeenCalled();
  });
});
