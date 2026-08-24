import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import crypto from 'crypto';
import { verifyWebhookSignature } from '../services/payment/monipay/monipay.service.js';

describe('Monipay webhook HMAC-SHA512', () => {
  const originalEnv = process.env;
  const secret = 'pri_test_webhook_secret';

  beforeEach(() => {
    process.env = { ...originalEnv, MONIPAY_SECRET_KEY: secret };
    delete process.env.MONIPAY_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function sign(payload) {
    return crypto.createHmac('sha512', secret).update(payload).digest('hex');
  }

  it('accepts HMAC-SHA512 of the raw body using MONIPAY_SECRET_KEY', () => {
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'order_12345' } });
    expect(verifyWebhookSignature(payload, sign(payload))).toBe(true);
  });

  it('accepts sha512= prefixed signatures', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    expect(verifyWebhookSignature(payload, `sha512=${sign(payload)}`)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    expect(verifyWebhookSignature(payload, 'deadbeef')).toBe(false);
  });

  it('rejects when signature is missing', () => {
    expect(verifyWebhookSignature('{}', '')).toBe(false);
    expect(verifyWebhookSignature('{}', null)).toBe(false);
  });

  it('uses MONIPAY_WEBHOOK_SECRET when set', () => {
    process.env.MONIPAY_WEBHOOK_SECRET = 'separate-webhook-secret';
    const payload = JSON.stringify({ event: 'charge.success' });
    const hash = crypto.createHmac('sha512', 'separate-webhook-secret').update(payload).digest('hex');
    expect(verifyWebhookSignature(payload, hash)).toBe(true);
    expect(verifyWebhookSignature(payload, sign(payload))).toBe(false);
  });
});
