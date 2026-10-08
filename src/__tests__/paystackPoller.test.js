import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGetSupabaseAdmin = jest.fn();
const mockVerifyPayment = jest.fn();
const mockProcessPaymentSuccess = jest.fn();
const mockUpdateTransactionStatus = jest.fn();
const mockGetTransactionByReference = jest.fn();
const mockProcessPaymentSuccessSideEffects = jest.fn();
const mockLogPaymentAudit = jest.fn();

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin()
}));

jest.unstable_mockModule('../services/payment/paystack/paystack.adapter.js', () => ({
  PaystackAdapter: { verifyPayment: (...args) => mockVerifyPayment(...args) }
}));

jest.unstable_mockModule('../services/payment/transaction.service.js', () => ({
  processPaymentSuccess: (...args) => mockProcessPaymentSuccess(...args),
  updateTransactionStatus: (...args) => mockUpdateTransactionStatus(...args),
  getTransactionByReference: (...args) => mockGetTransactionByReference(...args)
}));

jest.unstable_mockModule('../services/payment/order.service.js', () => ({
  getOrderById: jest.fn(async () => null),
  getOrderByTransactionId: jest.fn(async () => null)
}));

jest.unstable_mockModule('../services/payment/payment-success.service.js', () => ({
  PaymentSuccessService: {
    processPaymentSuccessSideEffects: (...args) => mockProcessPaymentSuccessSideEffects(...args)
  }
}));

jest.unstable_mockModule('../services/payment/audit.service.js', () => ({
  logPaymentAudit: (...args) => mockLogPaymentAudit(...args)
}));

// Fluent Supabase mock: returns a chainable thenable per query. Results are
// assigned in call order: sweep-update, pending select, abandoned select.
function mockDb(results) {
  let fromCalls = 0;
  return {
    from() {
      const idx = fromCalls++;
      const q = { data: results[idx] ?? [], error: null };
      const builder = {
        update: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve) => resolve(q)
      };
      return builder;
    }
  };
}

const baseTxn = (over) => ({
  id: 1,
  reference: 'ref-1',
  paystack_reference: 'PS-1',
  amount: 250000,
  user_id: 'user-123',
  car_id: 10,
  payment_type: 'renewal',
  metadata: JSON.stringify({ renewal_months: 12 }),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over
});

describe('PaystackPoller', () => {
  let Poller;

  beforeEach(async () => {
    jest.clearAllMocks();
    const { PaystackPoller } = await import('../services/payment/paystack/poller.service.js');
    Poller = PaystackPoller;
    mockProcessPaymentSuccessSideEffects.mockResolvedValue(undefined);
    mockLogPaymentAudit.mockResolvedValue(undefined);
  });

  it('recovers an abandoned row when the gateway confirms it was paid', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [], [baseTxn({ status: 'abandoned' })]]));
    mockVerifyPayment.mockResolvedValue({ success: true, status: 'success', amount: 250000 });
    mockUpdateTransactionStatus.mockResolvedValue(undefined);
    mockProcessPaymentSuccess.mockResolvedValue({ orderId: null, alreadyProcessed: true });
    mockGetTransactionByReference.mockResolvedValue(baseTxn({ status: 'successful' }));

    const poller = new Poller();
    await poller.tick();

    expect(mockVerifyPayment).toHaveBeenCalledWith('PS-1');
    // Reset to pending before crediting
    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('ref-1', { status: 'pending' });
    expect(mockProcessPaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1', status: 'successful' })
    );
    expect(mockLogPaymentAudit).toHaveBeenCalledWith(
      expect.objectContaining({ statusBefore: 'abandoned', statusAfter: 'successful' })
    );
  });

  it('leaves an abandoned row alone when the gateway has no payment', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [], [baseTxn({ status: 'abandoned' })]]));
    mockVerifyPayment.mockResolvedValue({ success: false, status: 'abandoned', amount: 0 });

    const poller = new Poller();
    await poller.tick();

    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
    expect(mockProcessPaymentSuccess).not.toHaveBeenCalled();
  });

  it('credits a paid pending row without any recovery step', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [baseTxn({ status: 'pending' })], []]));
    mockVerifyPayment.mockResolvedValue({ success: true, status: 'success', amount: 250000 });
    mockProcessPaymentSuccess.mockResolvedValue({ orderId: null, alreadyProcessed: true });
    mockGetTransactionByReference.mockResolvedValue(baseTxn({ status: 'successful' }));

    const poller = new Poller();
    await poller.tick();

    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
    expect(mockProcessPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentAudit).toHaveBeenCalledWith(
      expect.objectContaining({ statusBefore: 'pending', statusAfter: 'successful' })
    );
  });

  it('skips rows when gateway verification raises a transport error', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [baseTxn({ status: 'pending' })], []]));
    mockVerifyPayment.mockRejectedValue(new Error('timeout'));

    const poller = new Poller();
    await poller.tick();

    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
    expect(mockProcessPaymentSuccess).not.toHaveBeenCalled();
  });
});