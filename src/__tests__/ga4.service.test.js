import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const mockRunReport = jest.fn();

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn().mockImplementation(() => ({})) },
    analyticsdata: jest.fn(() => ({
      properties: { runReport: (...args) => mockRunReport(...args) }
    }))
  }
}));

const ORIGINAL_ENV = { ...process.env };

function setGaEnv() {
  process.env.GA4_PROPERTY_ID = '123456789';
  process.env.GA4_CLIENT_EMAIL = 'reader@test.iam.gserviceaccount.com';
  process.env.GA4_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
}

describe('ga4.service', () => {
  let ga4;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    ga4 = await import('../services/analytics/ga4.service.js');
    ga4.clearTrafficCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws a 503-style error when env vars are missing', async () => {
    delete process.env.GA4_PROPERTY_ID;
    await expect(ga4.getTrafficReport(7)).rejects.toMatchObject({ statusCode: 503 });
    expect(mockRunReport).not.toHaveBeenCalled();
  });

  it('returns parsed channels, pages and totals', async () => {
    setGaEnv();
    mockRunReport
      .mockResolvedValueOnce({
        data: {
          rows: [
            { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '100' }, { value: '80' }, { value: '250' }] },
            { dimensionValues: [{ value: 'Direct' }], metricValues: [{ value: '40' }, { value: '35' }, { value: '90' }] }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          rows: [
            { dimensionValues: [{ value: '/' }], metricValues: [{ value: '200' }, { value: '150' }] }
          ]
        }
      });

    const report = await ga4.getTrafficReport(7);

    expect(report.rangeDays).toBe(7);
    expect(report.totals).toEqual({ sessions: 140, users: 115, pageViews: 340 });
    expect(report.channels[0]).toEqual({
      channel: 'Organic Search', sessions: 100, users: 80, pageViews: 250
    });
    expect(report.pages).toEqual([{ path: '/', pageViews: 200, users: 150 }]);
    expect(mockRunReport).toHaveBeenCalledTimes(2);
    // Property-scoped request
    expect(mockRunReport.mock.calls[0][0].property).toBe('properties/123456789');
  });

  it('serves the second identical request from cache without new API calls', async () => {
    setGaEnv();
    mockRunReport
      .mockResolvedValue({ data: { rows: [] } });

    await ga4.getTrafficReport(7);
    const second = await ga4.getTrafficReport(7);

    expect(mockRunReport).toHaveBeenCalledTimes(2); // one tick = channels + pages
    expect(second.cached).toBe(true);
  });

  it('clamps the day range to 1..90', async () => {
    setGaEnv();
    mockRunReport.mockResolvedValue({ data: { rows: [] } });

    const r = await ga4.getTrafficReport(500);
    expect(r.rangeDays).toBe(90);
    expect(mockRunReport.mock.calls[0][0].requestBody.dateRanges[0].startDate).toBe('90daysAgo');
  });

  it('surfaces gateway failures as plain errors', async () => {
    setGaEnv();
    mockRunReport.mockRejectedValue(new Error('permission denied'));

    await expect(ga4.getTrafficReport(7)).rejects.toThrow('GA4 channel report failed');
  });
});
