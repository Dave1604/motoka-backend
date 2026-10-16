import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockGetSupabaseAdmin = jest.fn();

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
  getSupabaseUser: jest.fn()
}));
jest.unstable_mockModule('../services/notification.service.js', () => ({
  createInAppNotification: jest.fn()
}));
jest.unstable_mockModule('../services/email/paymentEmail.service.js', () => ({
  sendPaymentSuccessEmail: jest.fn()
}));
jest.unstable_mockModule('../services/payment/subscription.service.js', () => ({
  activateSubscription: jest.fn()
}));
jest.unstable_mockModule('../services/referral/referral.service.js', () => ({
  qualifyAndRewardOnFirstPurchase: jest.fn()
}));

const { PaymentSuccessService } = await import('../services/payment/payment-success.service.js');

function makeClient() {
  const client = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    // profile lookup fails so the side-effects return right after the order step
    single: jest.fn().mockResolvedValue({ data: null, error: { message: 'no profile' } })
  };
  return client;
}

const transaction = { id: 1, reference: 'ref-1', user_id: 'u1', amount: 1000, metadata: {} };

describe('payment success auto-processing', () => {
  let client;
  beforeEach(() => {
    client = makeClient();
    mockGetSupabaseAdmin.mockReturnValue(client);
  });

  it('moves a pending order to processing', async () => {
    const order = { id: 42, order_number: 'MTK-1', status: 'pending' };
    await PaymentSuccessService.processPaymentSuccessSideEffects({ transaction, gatewayData: {}, order });

    expect(client.from).toHaveBeenCalledWith('renewal_orders');
    expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing' }));
    expect(client.update.mock.calls[0][0].processing_started_at).toBeTruthy();
    expect(client.eq).toHaveBeenCalledWith('id', 42);
    expect(client.eq).toHaveBeenCalledWith('status', 'pending');
    expect(order.status).toBe('processing');
  });

  it('leaves a non-pending order alone', async () => {
    const order = { id: 43, order_number: 'MTK-2', status: 'completed' };
    await PaymentSuccessService.processPaymentSuccessSideEffects({ transaction, gatewayData: {}, order });

    expect(client.update).not.toHaveBeenCalled();
    expect(order.status).toBe('completed');
  });
});
