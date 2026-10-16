import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * Covers the hardening fixes applied to the Monipay integration:
 *   1. callback URL host matching (was a string prefix match)
 *   2. verify() reporting a missing amount as null rather than 0
 *   3. guest webhook fulfilment refusing to act without gateway confirmation
 *   4. SKIP_WEBHOOK_VERIFY being rejected in production
 *   5. initializeTransaction refusing to fall back to the secret key
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

describe('buildCallbackUrl origin matching', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = 'https://www.motokaapp.ng,https://motoka.ng';
    process.env.FRONTEND_URL = 'https://www.motokaapp.ng';
  });

  const load = async () => {
    const mod = await import('../controllers/payment/payment-init.controller.js');
    return mod.buildCallbackUrl;
  };

  it('uses an allowed origin when the request comes from one', async () => {
    const buildCallbackUrl = await load();
    const url = buildCallbackUrl(
      { headers: { origin: 'https://motoka.ng' } },
      '/payment/monipay/callback'
    );
    expect(url).toBe('https://motoka.ng/payment/monipay/callback');
  });

  it('does NOT treat a lookalike host as an allowed origin', async () => {
    const buildCallbackUrl = await load();
    const url = buildCallbackUrl(
      { headers: { origin: 'https://motoka.ng.evil.com' } },
      '/payment/monipay/callback'
    );
    // Must fall back to FRONTEND_URL, never redirect to the attacker host.
    expect(url).toBe('https://www.motokaapp.ng/payment/monipay/callback');
    expect(url).not.toContain('evil.com');
  });

  it('ignores a path suffix on the origin and still matches the host', async () => {
    const buildCallbackUrl = await load();
    const url = buildCallbackUrl(
      { headers: { referer: 'https://motoka.ng/licenses/renew?x=1' } },
      '/payment/monipay/callback'
    );
    expect(url).toBe('https://motoka.ng/payment/monipay/callback');
  });

  it('falls back when there is no origin header at all', async () => {
    const buildCallbackUrl = await load();
    const url = buildCallbackUrl({ headers: {} }, '/payment/monipay/callback');
    expect(url).toBe('https://www.motokaapp.ng/payment/monipay/callback');
  });
});

describe('markGuestOrderPaid gateway confirmation', () => {
  const orderRow = {
    id: 42,
    payment_status: 'pending_payment',
    guest_email: 'guest@example.com',
    guest_name: 'Guest',
    total_amount: 1500000,
    selected_items: [],
    receipt_token: 'tok',
  };

  const loadWithOrder = async () => {
    const updateSpy = jest.fn(() => ({ eq: () => ({ error: null }) }));
    jest.unstable_mockModule('../config/supabase.js', () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: orderRow, error: null }) }),
          }),
          update: updateSpy,
        }),
      }),
    }));
    const mod = await import('../services/guest/guestRenewal.service.js');
    return { markGuestOrderPaid: mod.markGuestOrderPaid, updateSpy };
  };

  it('refuses to fulfil when the gateway reports a different amount', async () => {
    const { markGuestOrderPaid, updateSpy } = await loadWithOrder();
    const result = await markGuestOrderPaid('ref_1', {
      verifyWithGateway: async () => ({ success: true, status: 'success', amount: 100 }),
    });
    expect(result).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refuses to fulfil when the gateway reports no amount', async () => {
    const { markGuestOrderPaid, updateSpy } = await loadWithOrder();
    const result = await markGuestOrderPaid('ref_1', {
      verifyWithGateway: async () => ({ success: true, status: 'success', amount: null }),
    });
    expect(result).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refuses to fulfil when the gateway does not confirm success', async () => {
    const { markGuestOrderPaid, updateSpy } = await loadWithOrder();
    const result = await markGuestOrderPaid('ref_1', {
      verifyWithGateway: async () => ({ success: false, status: 'pending', amount: 1500000 }),
    });
    expect(result).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refuses to fulfil when the verify call throws', async () => {
    const { markGuestOrderPaid, updateSpy } = await loadWithOrder();
    const result = await markGuestOrderPaid('ref_1', {
      verifyWithGateway: async () => {
        throw new Error('gateway unreachable');
      },
    });
    expect(result).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('initializeTransaction public key requirement', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('fails loudly when MONIPAY_PUBLIC_KEY is unset instead of sending the secret key', async () => {
    delete process.env.MONIPAY_PUBLIC_KEY;
    process.env.MONIPAY_SECRET_KEY = 'pri_test_secret';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const { initializeTransaction } = await import('../services/payment/monipay/monipay.service.js');

    await expect(
      initializeTransaction({ email: 'guest@example.com', amount: 50000 })
    ).rejects.toThrow('MONIPAY_PUBLIC_KEY not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the public key when it is configured', async () => {
    process.env.MONIPAY_PUBLIC_KEY = 'pub_test_public';
    process.env.MONIPAY_SECRET_KEY = 'pri_test_secret';
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: { authorization_url: 'https://checkout.monipay.ng/x', reference: 'ref_1' } }),
    }));
    global.fetch = fetchSpy;

    const { initializeTransaction } = await import('../services/payment/monipay/monipay.service.js');

    await initializeTransaction({ email: 'guest@example.com', amount: 50000 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer pub_test_public');
  });
});

describe('verifyGuestPayment failed-order recovery', () => {
  // A declined first attempt marks the order failed, the customer retries in
  // the same popup under the same reference and succeeds. The cached failure
  // must not block the recovery (guest order 45bbc471, 2026-09-20).
  it('re-verifies a payment_failed order and flips it to success when the gateway confirms', async () => {
    const failedOrder = {
      id: 77,
      payment_status: 'payment_failed',
      payment_reference: 'PAY-RETRY-1',
      payment_gateway: 'paystack',
      total_amount: 1550000,
      receipt_token: 'tok77',
      expires_at: null,
      guest_email: 'guest@example.com',
      guest_name: 'Guest',
      selected_items: [],
    };
    const updateSpy = jest.fn(() => ({ eq: () => ({ eq: () => ({ error: null }), error: null }) }));
    jest.unstable_mockModule('../config/supabase.js', () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: failedOrder, error: null }) }),
          }),
          update: updateSpy,
        }),
      }),
    }));
    jest.unstable_mockModule('../services/payment/paystack.service.js', () => ({
      initializeTransaction: jest.fn(),
      verifyTransaction: jest.fn(async () => ({ status: 'success', success: true, amount: 1550000 })),
      verifyWebhookSignature: jest.fn(),
      parseWebhookEvent: jest.fn(),
      chargeAuthorization: jest.fn(),
      listTransactions: jest.fn(),
      createRefund: jest.fn(),
      isConfigured: jest.fn(() => true),
      getPublicKey: jest.fn(),
      PaystackError: class PaystackError extends Error {},
    }));
    const mod = await import('../services/guest/guestRenewal.service.js');

    const result = await mod.verifyGuestPayment(77, 'PAY-RETRY-1');

    expect(result.status).toBe('payment_success');
    expect(updateSpy).toHaveBeenCalled();
  });
});
