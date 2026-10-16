import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGetTrafficReport = jest.fn();

jest.unstable_mockModule('../services/analytics/ga4.service.js', () => ({
  getTrafficReport: (...args) => mockGetTrafficReport(...args),
  GA4NotConfiguredError: class GA4NotConfiguredError extends Error {
    constructor(message) {
      super(message);
      this.name = 'GA4NotConfiguredError';
      this.statusCode = 503;
    }
  }
}));

const res = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
};

describe('getTrafficReportHandler', () => {
  let handler;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ getTrafficReportHandler: handler } = await import('../controllers/admin-analytics.controller.js'));
  });

  it('returns the report on success', async () => {
    const report = { rangeDays: 7, totals: { sessions: 1, users: 1, pageViews: 2 }, channels: [], pages: [] };
    mockGetTrafficReport.mockResolvedValue(report);
    const r = res();

    await handler({ query: { days: '7' } }, r);

    expect(mockGetTrafficReport).toHaveBeenCalledWith('7');
    expect(r.json).toHaveBeenCalledWith({ status: true, data: report });
  });

  it('returns 503 when GA4 is not configured', async () => {
    const { GA4NotConfiguredError } = await import('../services/analytics/ga4.service.js');
    mockGetTrafficReport.mockRejectedValue(new GA4NotConfiguredError('not configured'));
    const r = res();

    await handler({ query: {} }, r);

    expect(r.status).toHaveBeenCalledWith(503);
  });

  it('returns 502 on upstream failures without leaking internals', async () => {
    mockGetTrafficReport.mockRejectedValue(new Error('secret internals'));
    const r = res();

    await handler({ query: {} }, r);

    expect(r.status).toHaveBeenCalledWith(502);
    expect(r.json.mock.calls[0][0].message).not.toMatch('secret internals');
  });
});
