import { describe, it, expect, jest, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.unstable_mockModule('../middleware/rateLimiter.js', () => ({
  apiLimiter: (_req, _res, next) => next(),
  authLimiter: (_req, _res, next) => next(),
  otpLimiter: (_req, _res, next) => next(),
  passwordResetLimiter: (_req, _res, next) => next(),
  carRegistrationLimiter: (_req, _res, next) => next(),
  paymentLimiter: (_req, _res, next) => next(),
  webhookLimiter: (_req, _res, next) => next(),
  ladipoCartLimiter: (_req, _res, next) => next(),
  ladipoCheckoutLimiter: (_req, _res, next) => next(),
}));

jest.unstable_mockModule('../middleware/authenticate.js', () => ({
  authenticate: async (req, res, next) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    req.user = { id: '00000000-0000-4000-8000-000000000001', email: 't@example.com' };
    next();
  },
}));

jest.unstable_mockModule('../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: async (_req, _res, next) => next(),
}));

jest.unstable_mockModule('../controllers/ladipo.controller.js', () => ({
  handleGetCategories: (_req, res) => res.json({ ok: true }),
  handleGetParts: (_req, res) => res.json({ ok: true }),
  handleGetPartBySlug: (_req, res) => res.json({ ok: true }),
  handleGetCompatibility: (_req, res) => res.json({ ok: true }),
  handleUpsertCompatibility: (_req, res) => res.json({ ok: true }),
  handleDeleteCompatibilityEntry: (_req, res) => res.json({ ok: true }),
  handleGetCart: (_req, res) => res.json({ ok: true }),
  handleAddToCart: (_req, res) => res.json({ ok: true }),
  handleUpdateCartItem: (_req, res) => res.json({ ok: true }),
  handleDeleteCartItem: (_req, res) => res.json({ ok: true }),
  handleCreateOrder: (_req, res) => res.json({ ok: true }),
  handlePayOrder: (_req, res) => res.json({ ok: true }),
  handleVerifyPayment: (_req, res) => res.json({ ok: true }),
  handleGetUserOrders: (_req, res) => res.json({ ok: true }),
  handleGetOrder: (_req, res) => res.json({ ok: true }),
}));

let ladipoRoutes;

beforeAll(async () => {
  const mod = await import('../routes/ladipo.routes.js');
  ladipoRoutes = mod.default;
});

describe('Ladipo routes — auth required', () => {
  it('GET /ladipo/orders returns 401 without Authorization', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', ladipoRoutes);

    const res = await request(app).get('/api/ladipo/orders');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /ladipo/orders returns 200 with Bearer token (mocked user)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', ladipoRoutes);

    const res = await request(app)
      .get('/api/ladipo/orders')
      .set('Authorization', 'Bearer fake-test-token');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
