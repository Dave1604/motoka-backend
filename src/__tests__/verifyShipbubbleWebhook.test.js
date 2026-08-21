import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Shipbubble webhook HMAC-SHA512', () => {
  const secret = 'sb_prod_test_secret_key';
  let previousKey;
  let previousWebhook;

  beforeEach(async () => {
    previousKey = process.env.SHIPBUBBLE_API_KEY;
    previousWebhook = process.env.SHIPBUBBLE_WEBHOOK_SECRET;
    process.env.SHIPBUBBLE_API_KEY = secret;
    delete process.env.SHIPBUBBLE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env.SHIPBUBBLE_API_KEY = previousKey;
    if (previousWebhook == null) delete process.env.SHIPBUBBLE_WEBHOOK_SECRET;
    else process.env.SHIPBUBBLE_WEBHOOK_SECRET = previousWebhook;
  });

  it('accepts a valid x-ship-signature', async () => {
    const { verifyShipbubbleWebhookSignature } = await import(
      '../services/courier/shipbubble.service.js'
    );
    const body = Buffer.from(JSON.stringify({
      event: 'shipment.status.changed',
      order_id: 'SB-TEST123',
      status: 'picked_up',
    }), 'utf8');
    const signature = crypto.createHmac('sha512', secret).update(body).digest('hex');
    expect(verifyShipbubbleWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const { verifyShipbubbleWebhookSignature } = await import(
      '../services/courier/shipbubble.service.js'
    );
    const body = Buffer.from('{"event":"shipment.status.changed"}', 'utf8');
    expect(verifyShipbubbleWebhookSignature(body, 'deadbeef')).toBe(false);
  });
});
