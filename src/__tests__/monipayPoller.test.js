import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGetSupabaseAdmin = jest.fn();
const mockVerifyPayment = jest.fn();
const mockProcessPaymentSuccess = jest.fn();
const mockUpdateTransactionStatus = jest.fn();
const mockGetTransactionByReference = jest.fn();
const mockProcessPaymentSuccessSideEffects = jest.fn();
const mockLogPaymentAudit = jest.fn();
const mockHandleWalletFundingSuccess = jest.fn();

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin()
}));

jest.unstable_mockModule('../services/payment/monipay/index.js', () => ({
  MonipayAdapter: { verifyPayment: (...args) => mockVerifyPayment(...args) }
}));

jest.unstable_mockModule('../services/payment/transaction.service.js', () => ({
  processPaymentSuccess: (...args) => mockProcessPaymentSuccess(...args),
  updateTransactionStatus: (...args) => mockUpdateTransactionStatus(...args),
  getTransactionByReference: (...args) => mockGetTransactionByReference(...args)
}));

jest.unstable_mockModule('../services/payment/order.service.js', () => ({
  getOrderById: jest.fn(async () => null)
}));

jest.unstable_mockModule('../services/payment/payment-success.service.js', () => ({
  PaymentSuccessService: {
    processPaymentSuccessSideEffects: (...args) => mockProcessPaymentSuccessSideEffects(...args)
  }
}));

jest.unstable_mockModule('../services/payment/audit.service.js', () => ({
  logPaymentAudit: (...args) => mockLogPaymentAudit(...args)
}));

jest.unstable_mockModule('../services/wallet/wallet.service.js', () => ({
  handleWalletFundingSuccess: (...args) => mockHandleWalletFundingSuccess(...args)
}));

jest.unstable_mockModule('../services/guest/guestRenewal.service.js', () => ({
  verifyGuestPayment: jest.fn(async () => ({ status: 'pending_payment' }))
}));

// Fluent Supabase mock, results in call order: sweep-update, pending select,
// failed/abandoned select, guest-order select.
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
        in: jest.fn().mockReturnThis(),
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
  id: 383,
  reference: 'PAY-1',
  amount: 416244,
  user_id: 'user-1',
  car_id: null,
  payment_type: 'wallet_funding',
  metadata: { payment_type: 'wallet_funding', wallet_credit_kobo: 400000 },
  status: 'pending',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over
});

describe('MonipayPoller', () => {
  let poller;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('../services/payment/monipay/poller.service.js');
    poller = new mod.monipayPoller.constructor();
    mockUpdateTransactionStatus.mockResolvedValue(undefined);
    mockProcessPaymentSuccessSideEffects.mockResolvedValue(undefined);
    mockLogPaymentAudit.mockResolvedValue(undefined);
    mockHandleWalletFundingSuccess.mockResolvedValue({ credited: true, balanceAfter: 600000 });
  });

  it('recovers a wallet top-up the poller had marked failed once the gateway confirms it', async () => {
    const txn = baseTxn({ status: 'failed' });
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [], [txn], []]));
    mockVerifyPayment.mockResolvedValue({ success: true, status: 'success', amount: 416244 });

    await poller.tick();

    expect(mockVerifyPayment).toHaveBeenCalledWith('PAY-1');
    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('PAY-1', { status: 'pending' });
    expect(mockHandleWalletFundingSuccess).toHaveBeenCalledWith(txn, expect.objectContaining({ success: true }), txn.metadata);
    expect(mockProcessPaymentSuccess).not.toHaveBeenCalled();
  });

  it('leaves a pending row pending when the gateway only says the checkout was abandoned', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [baseTxn()], [], []]));
    mockVerifyPayment.mockResolvedValue({ success: false, status: 'abandoned', amount: null });

    await poller.tick();

    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
    expect(mockHandleWalletFundingSuccess).not.toHaveBeenCalled();
  });

  it('still records a gateway failure on a pending row', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [baseTxn()], [], []]));
    mockVerifyPayment.mockResolvedValue({ success: false, status: 'failed', amount: null });

    await poller.tick();

    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('PAY-1', { status: 'failed' });
    expect(poller.stats.failed).toBe(1);
  });

  it('does not touch an already-failed row the gateway still reports as failed', async () => {
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [], [baseTxn({ status: 'failed' })], []]));
    mockVerifyPayment.mockResolvedValue({ success: false, status: 'failed', amount: null });

    await poller.tick();

    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
    expect(poller.stats.failed).toBe(0);
  });

  it('recovers an abandoned renewal into an order and audits where it came from', async () => {
    const txn = baseTxn({
      id: 7,
      reference: 'PAY-7',
      status: 'abandoned',
      amount: 350000,
      car_id: 168,
      payment_type: 'renewal_manual',
      metadata: { payment_type: 'renewal_manual', renewal_months: 12 }
    });
    mockGetSupabaseAdmin.mockReturnValue(mockDb([[], [], [txn], []]));
    mockVerifyPayment.mockResolvedValue({ success: true, status: 'success', amount: 350000 });
    mockProcessPaymentSuccess.mockResolvedValue({ orderId: 'order-1', alreadyProcessed: false });
    mockGetTransactionByReference.mockResolvedValue({ ...txn, status: 'successful' });

    await poller.tick();

    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('PAY-7', { status: 'pending' });
    expect(mockProcessPaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'PAY-7', status: 'successful', orderType: 'renewal_manual' })
    );
    expect(mockLogPaymentAudit).toHaveBeenCalledWith(
      expect.objectContaining({ statusBefore: 'abandoned', statusAfter: 'successful' })
    );
  });
});
