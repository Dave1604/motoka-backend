import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';

// Mock logger before importing the middleware
jest.unstable_mockModule('../utils/logger.js', () => ({
  logError: jest.fn()
}));

describe('verifyMonicreditWebhook Middleware', () => {
  let verifyMonicreditWebhook;
  let req, res, next;
  const originalEnv = process.env;

  beforeEach(async () => {
    // Reset environment
    process.env = { ...originalEnv };
    
    // Import middleware after setting up mocks
    const module = await import('../middleware/verifyMonicreditWebhook.js');
    verifyMonicreditWebhook = module.verifyMonicreditWebhook;
    
    // Setup request/response mocks
    req = {
      headers: {},
      body: null
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    next = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('Production Mode - Strict Verification', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.MONICREDIT_WEBHOOK_SECRET = 'test-secret-key';
    });

    it('should reject requests without webhook secret', () => {
      delete process.env.MONICREDIT_WEBHOOK_SECRET;
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        status: false,
        message: 'Webhook verification configuration error'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests without signature header', () => {
      req.body = Buffer.from(JSON.stringify({ test: 'data' }));
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        status: false,
        message: 'Missing signature header'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      req.body = Buffer.from(payload);
      req.headers['x-monicredit-signature'] = 'invalid-signature';
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        status: false,
        message: 'Invalid signature'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept requests with valid SHA256 signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      req.body = Buffer.from(payload);
      
      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update(payload)
        .digest('hex');
      
      req.headers['x-monicredit-signature'] = signature;
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should accept requests with valid SHA512 signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      req.body = Buffer.from(payload);
      
      const signature = crypto
        .createHmac('sha512', 'test-secret-key')
        .update(payload)
        .digest('hex');
      
      req.headers['x-monicredit-signature'] = signature;
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should accept requests with prefixed SHA256 signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      req.body = Buffer.from(payload);
      
      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update(payload)
        .digest('hex');
      
      req.headers['x-monicredit-signature'] = `sha256=${signature}`;
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject requests with missing raw body', () => {
      req.body = null;
      req.headers['x-monicredit-signature'] = 'some-signature';
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        status: false,
        message: 'Invalid webhook payload'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle verification errors and reject in production', () => {
      // Force an error by making req.body invalid
      req.body = {};
      req.rawBody = null;
      req.headers['x-monicredit-signature'] = 'some-signature';
      
      // Mock Buffer.isBuffer to throw
      const originalIsBuffer = Buffer.isBuffer;
      Buffer.isBuffer = jest.fn(() => {
        throw new Error('Test error');
      });
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        status: false,
        message: 'Signature verification failed'
      });
      
      Buffer.isBuffer = originalIsBuffer;
    });
  });

  describe('Development Mode - Permissive', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should allow requests without webhook secret in development', () => {
      delete process.env.MONICREDIT_WEBHOOK_SECRET;
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow requests without signature in development', () => {
      process.env.MONICREDIT_WEBHOOK_SECRET = 'test-secret';
      req.body = Buffer.from(JSON.stringify({ test: 'data' }));
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow requests with invalid signature in development', () => {
      process.env.MONICREDIT_WEBHOOK_SECRET = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      req.body = Buffer.from(payload);
      req.headers['x-monicredit-signature'] = 'invalid-signature';
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('Signature Header Fallback', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.MONICREDIT_WEBHOOK_SECRET = 'test-secret-key';
    });

    it('should accept x-signature header as fallback', () => {
      const payload = JSON.stringify({ test: 'data' });
      req.body = Buffer.from(payload);
      
      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update(payload)
        .digest('hex');
      
      req.headers['x-signature'] = signature;
      delete req.headers['x-monicredit-signature'];
      
      verifyMonicreditWebhook(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
