import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const mockGetTransactionByReference = jest.fn();
const mockGetTransactionByPaystackReference = jest.fn();
const mockUpdateTransactionStatus = jest.fn();
const mockProcessPaymentSuccess = jest.fn();
const mockMarkTransactionAbandoned = jest.fn();
const mockPaystackVerify = jest.fn();
const mockGetSupabaseAdmin = jest.fn();
const mockProcessPaymentSuccessSideEffects = jest.fn();
const mockLogPaymentAudit = jest.fn();

jest.unstable_mockModule('../services/payment/transaction.service.js', () => ({
  createTransaction: jest.fn(),
  updateTransactionWithPaystackInit: jest.fn(),
  updateTransactionWithMonicreditInit: jest.fn(),
  updateTransactionWithMonipayInit: jest.fn(),
  getTransactionByMonicreditOrderId: jest.fn(),
  updateTransactionStatus: (...args) => mockUpdateTransactionStatus(...args),
  getTransactionByReference: (...args) => mockGetTransactionByReference(...args),
  getTransactionByPaystackReference: (...args) => mockGetTransactionByPaystackReference(...args),
  getTransactionById: jest.fn(),
  getTransactionByWebhookEventId: jest.fn(),
  updateTransactionWebhookEventId: jest.fn(),
  processPaymentSuccess: (...args) => mockProcessPaymentSuccess(...args),
  getUserTransactions: jest.fn(),
  getCarTransactions: jest.fn(),
  markTransactionAbandoned: (...args) => mockMarkTransactionAbandoned(...args),
  TransactionError: class TransactionError extends Error {
    constructor(message, statusCode = 500, code = null) {
      super(message);
      this.name = 'TransactionError';
      this.statusCode = statusCode;
      this.code = code;
    }
  }
}));

jest.unstable_mockModule('../services/payment/paystack.service.js', () => ({
  initializeTransaction: jest.fn(),
  verifyTransaction: (...args) => mockPaystackVerify(...args),
  verifyWebhookSignature: jest.fn(),
  parseWebhookEvent: jest.fn(),
  chargeAuthorization: jest.fn(),
  listTransactions: jest.fn(),
  createRefund: jest.fn(),
  pingApi: jest.fn(async () => ({ latencyMs: 1 })),
  isConfigured: jest.fn(() => true),
  getPublicKey: jest.fn(),
  PaystackError: class PaystackError extends Error {
    constructor(message, statusCode = 500, code = null, data = null) {
      super(message);
      this.name = 'PaystackError';
      this.statusCode = statusCode;
      this.code = code;
      this.data = data;
    }
  }
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
  handleWalletFundingSuccess: jest.fn()
}));

jest.unstable_mockModule('../services/email/paymentEmail.service.js', () => ({
  sendPaymentSuccessEmail: jest.fn(),
  sendPaymentFailedEmail: jest.fn(),
  sendOrderInProgressEmail: jest.fn(),
  sendGuestPaymentConfirmationEmail: jest.fn(),
  sendOrderCompletedEmail: jest.fn()
}));

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
  getSupabaseUser: jest.fn()
}));

jest.unstable_mockModule('../middleware/authenticate.js', () => ({
  authenticate: (req, res, next) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = { id: 'user-123', email: 'test@example.com' };
      return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}));

jest.unstable_mockModule('../middleware/checkEmailVerified.js', () => ({
  checkEmailVerified: (req, res, next) => next()
}));

jest.unstable_mockModule('../middleware/rateLimiter.js', () => {
  const passthrough = (req, res, next) => next();
  return {
    apiLimiter: passthrough,
    authLimiter: passthrough,
    otpLimiter: passthrough,
    passwordResetLimiter: passthrough,
    carRegistrationLimiter: passthrough,
    paymentLimiter: passthrough,
    webhookLimiter: passthrough,
    ladipoCartLimiter: passthrough,
    ladipoCheckoutLimiter: passthrough,
    contactLimiter: passthrough,
    loginAccountLimiter: passthrough,
    twoFAAccountLimiter: passthrough,
    moPublicChatLimiter: passthrough,
    moChatLimiter: passthrough
  };
});

function emptySupabaseClient() {
  const chainable = {
    results: [],
    from() {
      const q = {
        data: [], error: null
      };
      const builder = {
        update: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        then: (resolve) => resolve(q)
      };
      return builder;
    }
  };
  return chainable;
}

describe('verifyPayment abandoned-row recovery', () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api', paymentRoutes);
    mockGetSupabaseAdmin.mockReturnValue(emptySupabaseClient());
    mockProcessPaymentSuccessSideEffects.mockResolvedValue(undefined);
    mockLogPaymentAudit.mockResolvedValue(undefined);
  });

  it('recovers an abandoned transaction into successful when the gateway confirms payment', async () => {
    const abandonedTxn = {
      id: 41,
      reference: 'ref-abandoned',
      paystack_reference: 'PS-XYZ-1',
      amount: 250000,
      currency: 'NGN',
      status: 'abandoned',
      user_id: 'user-123',
      car_id: 10,
      payment_gateway: 'paystack',
      metadata: JSON.stringify({ carSlug: 'car-slug', renewal_months: 12 })
    };

    mockGetTransactionByReference
      .mockResolvedValueOnce(abandonedTxn)
      .mockResolvedValue({ ...abandonedTxn, status: 'successful' });
    mockPaystackVerify.mockResolvedValue({ status: 'success', amount: 250000 });
    mockUpdateTransactionStatus.mockResolvedValue(undefined);
    mockProcessPaymentSuccess.mockResolvedValue({
      transactionId: 41,
      orderId: null,
      alreadyProcessed: true
    });

    const res = await request(app)
      .get('/api/payments/verify/ref-abandoned')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data.status).toBe('success');
    // Abandoned row is reset to pending before the success path runs
    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('ref-abandoned', {
      status: 'pending'
    });
    expect(mockProcessPaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-abandoned', status: 'successful' })
    );
    // Audit records the true prior status
    expect(mockLogPaymentAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'ref-abandoned',
        statusBefore: 'abandoned',
        statusAfter: 'successful'
      })
    );
  });

  it('leaves an abandoned row abandoned when the gateway has no payment', async () => {
    mockGetTransactionByReference.mockResolvedValue({
      id: 42,
      reference: 'ref-abandoned-unpaid',
      paystack_reference: 'PS-XYZ-2',
      amount: 250000,
      currency: 'NGN',
      status: 'abandoned',
      user_id: 'user-123',
      payment_gateway: 'paystack',
      metadata: '{}'
    });
    mockPaystackVerify.mockResolvedValue({ status: 'abandoned', amount: 0 });

    const res = await request(app)
      .get('/api/payments/verify/ref-abandoned-unpaid')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
    expect(mockProcessPaymentSuccess).not.toHaveBeenCalled();
  });
});

describe('cancelPayment gateway guard', () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api', paymentRoutes);
  });

  it('refuses to abandon a pending transaction the gateway says is paid', async () => {
    mockGetTransactionByReference.mockResolvedValue({
      id: 51,
      reference: 'ref-paid',
      paystack_reference: 'PS-PAID-1',
      amount: 250000,
      status: 'pending',
      user_id: 'user-123',
      payment_gateway: 'paystack'
    });
    mockPaystackVerify.mockResolvedValue({ status: 'success', amount: 250000 });

    const res = await request(app)
      .put('/api/payments/ref-paid/cancel')
      .set('Authorization', 'Bearer valid-token')
      .send({ reason: 'User left payment page' });

    expect(res.status).toBe(409);
    expect(mockMarkTransactionAbandoned).not.toHaveBeenCalled();
  });

  it('still abandons when the gateway confirms no payment', async () => {
    mockGetTransactionByReference.mockResolvedValue({
      id: 52,
      reference: 'ref-unpaid',
      paystack_reference: 'PS-UNPAID-1',
      amount: 250000,
      status: 'pending',
      user_id: 'user-123',
      payment_gateway: 'paystack'
    });
    mockPaystackVerify.mockResolvedValue({ status: 'abandoned', amount: 0 });

    const res = await request(app)
      .put('/api/payments/ref-unpaid/cancel')
      .set('Authorization', 'Bearer valid-token')
      .send({ reason: 'User left payment page' });

    expect(res.status).toBe(200);
    expect(mockMarkTransactionAbandoned).toHaveBeenCalledWith('ref-unpaid', 'user_abandoned');
  });

  it('still abandons when gateway verification is unavailable (transport error)', async () => {
    mockGetTransactionByReference.mockResolvedValue({
      id: 53,
      reference: 'ref-timeout',
      paystack_reference: 'PS-TIMEOUT-1',
      amount: 250000,
      status: 'pending',
      user_id: 'user-123',
      payment_gateway: 'paystack'
    });
    mockPaystackVerify.mockRejectedValue(new Error('network down'));

    const res = await request(app)
      .put('/api/payments/ref-timeout/cancel')
      .set('Authorization', 'Bearer valid-token')
      .send({ reason: 'User left payment page' });

    expect(res.status).toBe(200);
    expect(mockMarkTransactionAbandoned).toHaveBeenCalledWith('ref-timeout', 'user_abandoned');
  });
});