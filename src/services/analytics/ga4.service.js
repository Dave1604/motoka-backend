import { google } from 'googleapis';
import { logError, logInfo, logDebug } from '../../utils/logger.js';

const CACHE_TTL_MS = parseInt(process.env.GA4_CACHE_TTL_MS || '900000', 10);
const cache = new Map();

export class GA4NotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GA4NotConfiguredError';
    this.statusCode = 503;
  }
}

function readConfig() {
  const propertyId = (process.env.GA4_PROPERTY_ID || '').trim();
  const clientEmail = (process.env.GA4_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!propertyId || !clientEmail || !privateKey) {
    throw new GA4NotConfiguredError(
      'GA4 reporting is not configured. Set GA4_PROPERTY_ID, GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY.'
    );
  }
  return { propertyId, clientEmail, privateKey };
}

function getClient() {
  const { clientEmail, privateKey } = readConfig();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  return google.analyticsdata({ version: 'v1beta', auth });
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  cache.delete(key);
  return null;
}

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
}

const clampDays = (days) => {
  const n = parseInt(days, 10);
  if (Number.isNaN(n)) return 7;
  return Math.min(Math.max(n, 1), 90);
};

const num = (row, i) => Number(row.metricValues?.[i]?.value || 0);
const str = (row, i) => row.dimensionValues?.[i]?.value || '(not set)';

export async function getTrafficReport(days = 7) {
  const range = clampDays(days);
  const cacheKey = `traffic:${range}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const { propertyId } = readConfig();
  const client = getClient();
  const property = `properties/${propertyId}`;
  const dateRange = { startDate: `${range}daysAgo`, endDate: 'today' };

  let channels;
  try {
    const res = await client.properties.runReport({
      property,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      },
    });
    channels = (res.data.rows || []).map((row) => ({
      channel: str(row, 0),
      sessions: num(row, 0),
      users: num(row, 1),
      pageViews: num(row, 2),
    }));
  } catch (err) {
    logError('[GA4] Channel report failed', { error: err.message });
    throw new Error(`GA4 channel report failed: ${err.message}`);
  }

  let pages;
  try {
    const res = await client.properties.runReport({
      property,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      },
    });
    pages = (res.data.rows || []).map((row) => ({
      path: str(row, 0),
      pageViews: num(row, 0),
      users: num(row, 1),
    }));
  } catch (err) {
    logError('[GA4] Pages report failed', { error: err.message });
    throw new Error(`GA4 pages report failed: ${err.message}`);
  }

  const totals = channels.reduce(
    (acc, c) => ({
      sessions: acc.sessions + c.sessions,
      users: acc.users + c.users,
      pageViews: acc.pageViews + c.pageViews,
    }),
    { sessions: 0, users: 0, pageViews: 0 }
  );

  const report = { rangeDays: range, totals, channels, pages, cached: false };
  cacheSet(cacheKey, report);
  logInfo('[GA4] Traffic report served', { rangeDays: range });
  return report;
}

export function clearTrafficCache() {
  cache.clear();
  logDebug('[GA4] Traffic cache cleared');
}
