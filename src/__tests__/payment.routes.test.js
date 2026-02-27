import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const mockGetRenewalItems = jest.fn();
const mockValidateRenewalItemsSelection = jest.fn();
const mockCreateTransaction = jest.fn();
const mockUpdateTransactionWithPaystackInit = jest.fn();
const mockPaystackInitialize = jest.fn();
const mockGetSupabaseAdmin = jest.fn();
const mockValidateStateAndLGA = jest.fn();
const mockResolveStateAndLGA = jest.fn();
const mockGetTransactionByReference = jest.fn();
const mockPaystackVerify = jest.fn();
const mockUpdateTransactionStatus = jest.fn();
const mockParseWebhookEvent = jest.fn();
const mockVerifyWebhookSignature = jest.fn();
const mockGetTransactionByPaystackReference = jest.fn();
const mockProcessPaymentSuccess = jest.fn();
const mockSendPaymentFailedEmail = jest.fn();
const mockCreateInAppNotification = jest.fn();

// Mock renewal items service
jest.unstable_mockModule('../services/payment/renewalItems.service.js', () => ({
  getRenewalItems: (...args) => mockGetRenewalItems(...args),
  validateRenewalItemsSelection: (...args) => mockValidateRenewalItemsSelection(...args)
}));

jest.unstable_mockModule('../services/payment/transaction.service.js', () => ({
  createTransaction: (...args) => mockCreateTransaction(...args),
  updateTransactionWithPaystackInit: (...args) => mockUpdateTransactionWithPaystackInit(...args),
  updateTransactionStatus: (...args) => mockUpdateTransactionStatus(...args),
  getTransactionByReference: (...args) => mockGetTransactionByReference(...args),
  getTransactionByPaystackReference: (...args) => mockGetTransactionByPaystackReference(...args),
  getTransactionById: jest.fn(),
  getTransactionByWebhookEventId: jest.fn(),
  updateTransactionWebhookEventId: jest.fn(),
  processPaymentSuccess: (...args) => mockProcessPaymentSuccess(...args),
  getUserTransactions: jest.fn(),
  getCarTransactions: jest.fn(),
  hasSuccessfulPayment: jest.fn(),
  getLatestSuccessfulTransaction: jest.fn(),
  markTransactionAbandoned: jest.fn(),
  markTransactionRefunded: jest.fn(),
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
  initializeTransaction: (...args) => mockPaystackInitialize(...args),
  verifyTransaction: (...args) => mockPaystackVerify(...args),
  verifyWebhookSignature: (...args) => mockVerifyWebhookSignature(...args),
  parseWebhookEvent: (...args) => mockParseWebhookEvent(...args),
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

jest.unstable_mockModule('../services/notification.service.js', () => ({
  createInAppNotification: (...args) => mockCreateInAppNotification(...args)
}));

jest.unstable_mockModule('../services/email/paymentEmail.service.js', () => ({
  sendPaymentSuccessEmail: jest.fn(),
  sendPaymentFailedEmail: (...args) => mockSendPaymentFailedEmail(...args)
}));

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
  getSupabaseUser: jest.fn()
}));

jest.unstable_mockModule('../constants/states.constants.js', () => ({
  getAllStates: jest.fn(),
  getLGAsByState: jest.fn(),
  validateStateAndLGA: (...args) => mockValidateStateAndLGA(...args),
  getDeliveryFee: jest.fn(),
  getLGANameFromInput: jest.fn(),
  getStateCodeFromInput: jest.fn(),
  resolveStateAndLGA: jest.fn()
}));

jest.unstable_mockModule('../services/location.service.js', () => ({
  getAllStates: jest.fn(),
  getLGAsByState: jest.fn(),
  getDeliveryFee: jest.fn(),
  resolveStateAndLGA: (...args) => mockResolveStateAndLGA(...args),
  validateStateAndLGA: (...args) => mockValidateStateAndLGA(...args)
}));

// Mock authentication middleware
jest.unstable_mockModule('../middleware/authenticate.js', () => ({
  authenticate: (req, res, next) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = {
        id: 'user-123',
        email: 'test@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z'
      };
      req.token = 'valid-token';
      return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}));

// Mock email verification middleware
jest.unstable_mockModule('../middleware/checkEmailVerified.js', () => ({
  checkEmailVerified: (req, res, next) => next()
}));

// Mock rate limiter
jest.unstable_mockModule('../middleware/rateLimiter.js', () => ({
  paymentLimiter: (req, res, next) => next()
}));

describe('Payment routes', () => {
  let app;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(async () => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const paymentRoutes = (await import('../routes/payment.routes.js')).default;

    app = express();
    app.use(express.json());
    app.use('/api', paymentRoutes);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('GET /api/payments/renewal-items returns DB items', async () => {
    mockGetRenewalItems.mockResolvedValueOnce([
      { id: 'vehicle_licence', name: 'Vehicle Licence', price: 470000, required: true },
      { id: 'insurance', name: 'Insurance', price: 1500000, required: false }
    ]);

    const res = await request(app)
      .get('/api/payment-schedule')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe('vehicle_licence');
  });

  it('POST /api/payments/initialize calculates total from DB items and delivery fee', async () => {
    const mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 10,
          slug: 'car-slug',
          vehicle_make: 'Toyota',
          vehicle_model: 'Corolla',
          registration_no: 'REG123',
          expiry_date: '2025-01-01',
          status: 'active',
          user_id: 'user-123'
        },
        error: null
      })
    };

    mockGetSupabaseAdmin.mockReturnValue(mockSupabaseClient);

    mockResolveStateAndLGA.mockResolvedValue({ valid: true, delivery_fee: 50000, stateCode: 'LA', lgaName: 'Ikeja' });
    mockValidateRenewalItemsSelection.mockResolvedValue({ valid: true, total: 200000 });

    mockCreateTransaction.mockResolvedValue({
      id: 1,
      reference: 'ref-123',
      amount: 250000
    });

    mockPaystackInitialize.mockResolvedValue({
      authorization_url: 'https://paystack.test/auth',
      access_code: 'access-123',
      reference: 'ref-123'
    });

    mockUpdateTransactionWithPaystackInit.mockResolvedValue({
      id: 1,
      reference: 'ref-123'
    });

    const payload = {
      car_slug: 'car-slug',
      payment_schedule_id: ['vehicle_licence', 'insurance'],
      renewal_months: 12,
      delivery_details: {
        address: '1 Test St',
        state: 'LA',
        lga: 'Ikeja',
        contact: '08000000000'
      }
    };

    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', 'Bearer valid-token')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data.reference).toBe('ref-123');

    expect(mockCreateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 250000
      })
    );
  });

  it('GET /api/payments/verify/:reference is read-only on success', async () => {
    const mockTransaction = {
      id: 1,
      reference: 'ref-verify',
      amount: 250000,
      currency: 'NGN',
      status: 'successful',
      user_id: 'user-123',
      metadata: JSON.stringify({ carSlug: 'car-slug' })
    };

    mockGetTransactionByReference.mockResolvedValue(mockTransaction);

    const res = await request(app)
      .get('/api/payments/verify/ref-verify')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data.status).toBe('success');
  });

  it('POST /api/webhooks/paystack rejects amount mismatch and marks failed', async () => {
    mockVerifyWebhookSignature.mockReturnValue(true);
    mockParseWebhookEvent.mockReturnValue({
      event: 'charge.success',
      data: {
        reference: 'ref-123',
        amount: 300000,
        currency: 'NGN',
        channel: 'card',
        paid_at: '2025-01-01T10:00:00Z',
        metadata: {
          user_id: 'user-123',
          car_id: 10
        }
      }
    });

    mockGetTransactionByReference.mockResolvedValue(null);
    mockGetTransactionByPaystackReference.mockResolvedValue({
      id: 1,
      reference: 'ref-123',
      amount: 250000,
      currency: 'NGN',
      status: 'pending',
      user_id: 'user-123',
      car_id: 10,
      metadata: {}
    });

    const webhookApp = express();
    webhookApp.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }));
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    webhookApp.use('/api', paymentRoutes);

    const res = await request(webhookApp)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', 'test-signature')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'charge.success', data: { reference: 'ref-123' } }));

    expect(res.status).toBe(200);
    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('ref-123', {
      status: 'failed'
    });
  });

  it('POST /api/webhooks/paystack is idempotent for duplicate deliveries', async () => {
    const mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null })
    };
    mockGetSupabaseAdmin.mockReturnValue(mockSupabaseClient);

    const webhookApp = express();
    webhookApp.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }));
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    webhookApp.use('/api', paymentRoutes);

    mockVerifyWebhookSignature.mockReturnValue(true);

    const baseEvent = {
      event: 'charge.success',
      data: {
        reference: 'ref-dup',
        amount: 250000,
        currency: 'NGN',
        channel: 'card',
        paid_at: '2025-01-01T10:00:00Z',
        metadata: {
          user_id: 'user-123',
          car_id: 10
        }
      }
    };

    mockParseWebhookEvent.mockReturnValue(baseEvent);
    mockGetTransactionByPaystackReference.mockResolvedValue({
      id: 2,
      reference: 'ref-dup',
      amount: 250000,
      currency: 'NGN',
      status: 'pending',
      user_id: 'user-123',
      car_id: 10,
      metadata: {}
    });

    mockProcessPaymentSuccess.mockResolvedValue({
      transactionId: 2,
      orderId: 100,
      alreadyProcessed: false
    });

    await request(webhookApp)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', 'test-signature')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(baseEvent));

    mockProcessPaymentSuccess.mockResolvedValue({
      transactionId: 2,
      orderId: 100,
      alreadyProcessed: true
    });

    await request(webhookApp)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', 'test-signature')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(baseEvent));

    expect(mockProcessPaymentSuccess).toHaveBeenCalledTimes(2);
    expect(mockUpdateTransactionStatus).not.toHaveBeenCalled();
  });

  it('POST /api/webhooks/paystack handles charge.failed with notifications', async () => {
    const webhookApp = express();
    webhookApp.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }));
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    webhookApp.use('/api', paymentRoutes);

    mockVerifyWebhookSignature.mockReturnValue(true);
    mockParseWebhookEvent.mockReturnValue({
      event: 'charge.failed',
      data: {
        reference: 'ref-fail'
      }
    });

    mockGetTransactionByPaystackReference.mockResolvedValue({
      id: 5,
      reference: 'ref-fail',
      amount: 250000,
      currency: 'NGN',
      status: 'pending',
      user_id: 'user-123',
      car_id: 10
    });

    const mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn()
        .mockResolvedValueOnce({ data: { email: 'test@example.com', first_name: 'Test', user_id: 'user-123' }, error: null })
        .mockResolvedValueOnce({ data: { vehicle_make: 'Toyota', vehicle_model: 'Corolla', registration_no: 'REG123' }, error: null })
    };
    mockGetSupabaseAdmin.mockReturnValue(mockSupabaseClient);

    const res = await request(webhookApp)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', 'test-signature')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'charge.failed', data: { reference: 'ref-fail' } }));

    expect(res.status).toBe(200);
    expect(mockUpdateTransactionStatus).toHaveBeenCalledWith('ref-fail', { status: 'failed' });
    expect(mockSendPaymentFailedEmail).toHaveBeenCalledTimes(1);
    expect(mockCreateInAppNotification).toHaveBeenCalledTimes(1);
  });

  it('POST /api/webhooks/paystack handles concurrent duplicate deliveries safely', async () => {
    const webhookApp = express();
    webhookApp.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }));
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    webhookApp.use('/api', paymentRoutes);

    mockVerifyWebhookSignature.mockReturnValue(true);
    mockParseWebhookEvent.mockReturnValue({
      event: 'charge.success',
      data: {
        reference: 'ref-concurrent',
        amount: 250000,
        currency: 'NGN',
        channel: 'card',
        paid_at: '2025-01-01T10:00:00Z',
        metadata: {
          user_id: 'user-123',
          car_id: 10
        }
      }
    });

    mockGetTransactionByPaystackReference.mockResolvedValue({
      id: 3,
      reference: 'ref-concurrent',
      amount: 250000,
      currency: 'NGN',
      status: 'pending',
      user_id: 'user-123',
      car_id: 10,
      metadata: {}
    });

    mockProcessPaymentSuccess
      .mockResolvedValueOnce({ transactionId: 3, orderId: 200, alreadyProcessed: false })
      .mockResolvedValueOnce({ transactionId: 3, orderId: 200, alreadyProcessed: true });

    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-concurrent' } });

    const [first, second] = await Promise.all([
      request(webhookApp)
        .post('/api/webhooks/paystack')
        .set('x-paystack-signature', 'test-signature')
        .set('Content-Type', 'application/json')
        .send(payload),
      request(webhookApp)
        .post('/api/webhooks/paystack')
        .set('x-paystack-signature', 'test-signature')
        .set('Content-Type', 'application/json')
        .send(payload)
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockProcessPaymentSuccess).toHaveBeenCalledTimes(2);
  });

  it('POST /api/webhooks/paystack rejects replay attack with invalid signature', async () => {
    const webhookApp = express();
    webhookApp.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }));
    const paymentRoutes = (await import('../routes/payment.routes.js')).default;
    webhookApp.use('/api', paymentRoutes);

    mockVerifyWebhookSignature.mockReturnValue(false);

    const res = await request(webhookApp)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', 'invalid-signature')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'charge.success', data: { reference: 'ref-replay' } }));

    expect(res.status).toBe(401);
    expect(mockParseWebhookEvent).not.toHaveBeenCalled();
    expect(mockProcessPaymentSuccess).not.toHaveBeenCalled();
  });
});
