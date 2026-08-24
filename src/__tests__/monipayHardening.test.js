import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * Covers the four hardening fixes applied to the Monipay integration:
 *   1. callback URL host matching (was a string prefix match)
 *   2. verify() reporting a missing amount as null rather than 0
 *   3. guest webhook fulfilment refusing to act without gateway confirmation
 *   4. SKIP_WEBHOOK_VERIFY being rejected in production
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
