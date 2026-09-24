import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Short ping ceiling so the timeout path runs fast. Read once at module load.
process.env.GATEWAY_HEALTH_PING_TIMEOUT_MS = '60';

const mockPingPaystack = jest.fn();
const mockPingMonipay = jest.fn();

jest.unstable_mockModule('../services/payment/gateway/gateway.factory.js', () => ({
  GatewayFactory: {
    getSupportedGateways: () => ['paystack', 'monipay'],
    getGateway: (name) =>
      name === 'paystack'
        ? { ping: (...args) => mockPingPaystack(...args) }
        : { ping: (...args) => mockPingMonipay(...args) },
  },
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logError: jest.fn(),
  logWarn: jest.fn(),
  logInfo: jest.fn(),
  logDebug: jest.fn(),
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe('paystack pingApi', () => {
  it('resolves latency on a 200 using the secret key against /bank', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: true, data: [] }),
    }));
    global.fetch = fetchSpy;

    const { pingApi } = await import('../services/payment/paystack.service.js');
    const result = await pingApi();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/bank?currency=NGN');
    expect(options.headers.Authorization).toBe('Bearer sk_test_x');
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('throws PING_UNAUTHORIZED on 401', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_bad';
    global.fetch = jest.fn(async () => ({ ok: false, status: 401 }));

    const { pingApi } = await import('../services/payment/paystack.service.js');
    await expect(pingApi()).rejects.toMatchObject({ code: 'PING_UNAUTHORIZED' });
  });

  it('throws PING_FAILED when the network fails', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    global.fetch = jest.fn(async () => {
      throw new Error('socket hang up');
    });

    const { pingApi } = await import('../services/payment/paystack.service.js');
    await expect(pingApi()).rejects.toMatchObject({ code: 'PING_FAILED' });
  });

  it('throws CONFIG_ERROR without calling fetch when no key is set', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const { pingApi } = await import('../services/payment/paystack.service.js');
    await expect(pingApi()).rejects.toThrow('PAYSTACK_SECRET_KEY not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('monipay pingApi', () => {
  it('treats a 404 for the bogus reference as reachable', async () => {
    process.env.MONIPAY_SECRET_KEY = 'pri_test_secret';
    const fetchSpy = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ message: 'not found' }),
    }));
    global.fetch = fetchSpy;

    const { pingApi } = await import('../services/payment/monipay/monipay.service.js');
    const result = await pingApi();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('/transaction/verify/__healthcheck__');
    expect(options.headers.Authorization).toBe('Bearer pri_test_secret');
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('resolves on 200', async () => {
    process.env.MONIPAY_SECRET_KEY = 'pri_test_secret';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));

    const { pingApi } = await import('../services/payment/monipay/monipay.service.js');
    await expect(pingApi()).resolves.toEqual({
      latencyMs: expect.any(Number),
    });
  });

  it('throws PING_UNAUTHORIZED on 401', async () => {
    process.env.MONIPAY_SECRET_KEY = 'pri_test_bad';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));

    const { pingApi } = await import('../services/payment/monipay/monipay.service.js');
    await expect(pingApi()).rejects.toMatchObject({ code: 'PING_UNAUTHORIZED' });
  });

  it('throws PING_FAILED when the network fails', async () => {
    process.env.MONIPAY_SECRET_KEY = 'pri_test_secret';
    global.fetch = jest.fn(async () => {
      throw new Error('socket hang up');
    });

    const { pingApi } = await import('../services/payment/monipay/monipay.service.js');
    await expect(pingApi()).rejects.toMatchObject({ code: 'PING_FAILED' });
  });
});

describe('health monitor', () => {
  beforeEach(async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    healthMonitor.stop();
    healthMonitor.resetMetrics('paystack');
  });

  afterEach(async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    healthMonitor.stop();
  });

  it('starts unknown and idle before the first check', async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');

    expect(healthMonitor.isRunning).toBe(false);
    const all = healthMonitor.getAllGatewayHealth();
    expect(all.paystack.status).toBe('unknown');
    expect(all.paystack.totalChecks).toBe(0);
  });

  it('marks gateways healthy when pings succeed and stops cleanly', async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    mockPingPaystack.mockResolvedValue({ ok: true, latencyMs: 12 });
    mockPingMonipay.mockResolvedValue({ ok: true, latencyMs: 20 });

    healthMonitor.start();
    expect(healthMonitor.isRunning).toBe(true);
    await new Promise((r) => setTimeout(r, 100));

    const paystack = healthMonitor.getGatewayHealth('paystack');
    expect(paystack.status).toBe('healthy');
    expect(paystack.totalChecks).toBe(1);
    expect(paystack.successCount).toBe(1);
    expect(paystack.responseTime).toBe(12);

    healthMonitor.stop();
    expect(healthMonitor.isRunning).toBe(false);
  });

  it('marks a gateway degraded on ping failure', async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    mockPingPaystack.mockRejectedValue(new Error('socket hang up'));
    mockPingMonipay.mockResolvedValue({ ok: true, latencyMs: 20 });

    await healthMonitor.performHealthChecks();

    const paystack = healthMonitor.getGatewayHealth('paystack');
    expect(paystack.status).toBe('degraded');
    expect(paystack.failureCount).toBe(1);
    expect(healthMonitor.getGatewayHealth('monipay').status).toBe('healthy');
  });

  it('marks a gateway unhealthy after 5 consecutive failures', async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    mockPingPaystack.mockRejectedValue(new Error('socket hang up'));
    mockPingMonipay.mockResolvedValue({ ok: true, latencyMs: 20 });

    for (let i = 0; i < 5; i++) {
      await healthMonitor.performHealthChecks();
    }

    const paystack = healthMonitor.getGatewayHealth('paystack');
    expect(paystack.status).toBe('unhealthy');
    expect(paystack.failureCount).toBe(5);
  });

  it('records a failure when the adapter has no ping()', async () => {
    const { GatewayFactory } =
      await import('../services/payment/gateway/gateway.factory.js');
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    const original = GatewayFactory.getGateway;
    GatewayFactory.getGateway = () => ({});
    try {
      await healthMonitor.performHealthChecks();
      const paystack = healthMonitor.getGatewayHealth('paystack');
      expect(paystack.failureCount).toBe(1);
      expect(paystack.errors[0].code).toBe('PING_NOT_IMPLEMENTED');
    } finally {
      GatewayFactory.getGateway = original;
    }
  });

  it('times out a hung ping instead of jamming the interval', async () => {
    const { healthMonitor } =
      await import('../services/payment/gateway/health-monitor.js');
    mockPingPaystack.mockImplementation(() => new Promise(() => {}));
    mockPingMonipay.mockResolvedValue({ ok: true, latencyMs: 20 });

    await healthMonitor.performHealthChecks();

    const paystack = healthMonitor.getGatewayHealth('paystack');
    expect(paystack.failureCount).toBe(1);
    expect(paystack.errors[0].code).toBe('PING_TIMEOUT');
  });
});
