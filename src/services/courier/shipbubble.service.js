import { logError, logDebug } from '../../utils/logger.js';
import { retryWithBackoff } from '../../utils/retry.js';
import crypto from 'crypto';

export class ShipbubbleError extends Error {
  constructor(message, statusCode = 502, code = 'SHIPBUBBLE_ERROR', data = null) {
    super(message);
    this.name = 'ShipbubbleError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

export function getShipbubbleBaseUrl() {
  return (process.env.SHIPBUBBLE_BASE_URL || 'https://api.shipbubble.com/v1').replace(/\/$/, '');
}

export function isShipbubbleConfigured() {
  return Boolean(String(process.env.SHIPBUBBLE_API_KEY || '').trim());
}

export function isShipbubbleSandbox() {
  return String(process.env.SHIPBUBBLE_API_KEY || '').startsWith('sb_sandbox');
}

/** Live booking charges the Shipbubble wallet. Sandbox is allowed; live needs an explicit flag. */
export function isShipbubbleBookingEnabled() {
  if (!isShipbubbleConfigured()) return false;
  const flag = String(process.env.SHIPBUBBLE_BOOKING_ENABLED || '').toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return isShipbubbleSandbox();
}

function getWebhookSecret() {
  return String(
    process.env.SHIPBUBBLE_WEBHOOK_SECRET || process.env.SHIPBUBBLE_API_KEY || ''
  ).trim();
}

/**
 * Verify Shipbubble webhook signature (HMAC-SHA512 of raw body).
 * Header: x-ship-signature
 * @see https://docs.shipbubble.com/api-reference/webhooks.md
 */
export function verifyShipbubbleWebhookSignature(rawBody, signature) {
  const secret = getWebhookSecret();
  if (!secret || !signature) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  const received = String(signature).trim().toLowerCase().replace(/^sha512=/, '');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function timeoutMs() {
  return parseInt(process.env.SHIPBUBBLE_REQUEST_TIMEOUT_MS || '20000', 10);
}

function maxRetries() {
  return parseInt(process.env.SHIPBUBBLE_MAX_RETRIES || '2', 10);
}

async function shipbubbleRequest(path, { method = 'GET', body = null, query = null } = {}) {
  if (!isShipbubbleConfigured()) {
    throw new ShipbubbleError(
      'Shipbubble is not configured. Set SHIPBUBBLE_API_KEY on the server.',
      503,
      'CONFIG_ERROR'
    );
  }

  const url = new URL(`${getShipbubbleBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  const retries = maxRetries();
  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs());
      try {
        const response = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${process.env.SHIPBUBBLE_API_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body != null ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        let data = null;
        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }

        const statusOk = response.ok && String(data?.status || 'success').toLowerCase() !== 'failed';
        if (!statusOk) {
          const message =
            data?.message ||
            (Array.isArray(data?.errors) ? data.errors.join('; ') : null) ||
            `Shipbubble request failed (${response.status})`;
          logError('[Shipbubble] API error', { path, method, message, status: response.status });
          throw new ShipbubbleError(
            message,
            response.status >= 500 ? 502 : response.status === 401 || response.status === 403 ? 503 : 400,
            response.status === 401 || response.status === 403 ? 'CONFIG_ERROR' : 'API_ERROR',
            data
          );
        }

        logDebug('[Shipbubble] request ok', { path, method });
        return data;
      } catch (error) {
        if (error instanceof ShipbubbleError) throw error;
        if (error.name === 'AbortError') {
          throw new ShipbubbleError('Shipbubble request timed out', 504, 'REQUEST_TIMEOUT');
        }
        throw new ShipbubbleError(
          error.message || 'Shipbubble request failed',
          502,
          'REQUEST_FAILED'
        );
      } finally {
        clearTimeout(timer);
      }
    },
    {
      maxRetries: retries,
      context: `Shipbubble ${method} ${path}`,
    }
  );
}

/** Next eligible pickup date (yyyy-mm-dd). After 18:00 WAT, schedule tomorrow. */
export function nextPickupDate(now = new Date()) {
  const wat = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  if (wat.getHours() >= 18) {
    wat.setDate(wat.getDate() + 1);
  }
  const y = wat.getFullYear();
  const m = String(wat.getMonth() + 1).padStart(2, '0');
  const d = String(wat.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function validateAddress({ name, email, phone, address }) {
  const data = await shipbubbleRequest('/shipping/address/validate', {
    method: 'POST',
    body: { name, email, phone, address },
  });
  return data?.data || data;
}

export async function getPackageCategories() {
  const data = await shipbubbleRequest('/shipping/labels/categories', { method: 'GET' });
  return Array.isArray(data?.data) ? data.data : [];
}

let categoryCache = { id: null, fetchedAt: 0 };
const CATEGORY_TTL_MS = 6 * 60 * 60 * 1000;

export async function resolveDocumentCategoryId() {
  const fromEnv = String(process.env.SHIPBUBBLE_CATEGORY_ID || '').trim();
  if (fromEnv) return Number(fromEnv) || fromEnv;

  if (categoryCache.id && Date.now() - categoryCache.fetchedAt < CATEGORY_TTL_MS) {
    return categoryCache.id;
  }

  const categories = await getPackageCategories();
  const preferred = categories.find((c) =>
    /document|paper|sensitive|accessories|others?|general|light weight/i.test(String(c.category || ''))
  );
  const chosen = preferred || categories[0];
  if (!chosen?.category_id) {
    throw new ShipbubbleError('No Shipbubble package categories available', 502, 'API_ERROR');
  }
  categoryCache = { id: chosen.category_id, fetchedAt: Date.now() };
  return chosen.category_id;
}

/**
 * Fetch courier rates. Returns { request_token, couriers, cheapest_courier, ... }.
 * Note: Shipbubble spells receiver as "reciever_address_code".
 */
export async function fetchShippingRates({
  senderAddressCode,
  receiverAddressCode,
  categoryId,
  packageItems,
  packageDimension,
  pickupDate,
  serviceType = 'pickup',
  deliveryInstructions,
}) {
  const data = await shipbubbleRequest('/shipping/fetch_rates', {
    method: 'POST',
    body: {
      sender_address_code: Number(senderAddressCode),
      reciever_address_code: Number(receiverAddressCode),
      pickup_date: pickupDate || nextPickupDate(),
      category_id: Number(categoryId),
      package_items: packageItems,
      package_dimension: packageDimension,
      service_type: serviceType,
      ...(deliveryInstructions ? { delivery_instructions: deliveryInstructions } : {}),
    },
  });
  return data?.data || data;
}

export async function createShipmentLabel({ requestToken, serviceCode, courierId }) {
  const data = await shipbubbleRequest('/shipping/labels', {
    method: 'POST',
    body: {
      request_token: requestToken,
      service_code: serviceCode,
      courier_id: courierId,
    },
  });
  return data?.data || data;
}

export async function trackShipbubbleShipments(orderIds) {
  const ids = Array.isArray(orderIds) ? orderIds.join(',') : String(orderIds || '');
  if (!ids) {
    throw new ShipbubbleError('No Shipbubble order id to track', 400, 'NO_WAYBILL');
  }
  const data = await shipbubbleRequest(`/shipping/labels/list/${encodeURIComponent(ids)}`, {
    method: 'GET',
  });
  const results = data?.data?.results || data?.results || [];
  return Array.isArray(results) ? results : [];
}

export async function trackShipbubbleShipment(orderId) {
  const results = await trackShipbubbleShipments([orderId]);
  return results[0] || null;
}

export function pickCheapestShipbubbleCourier(ratePayload) {
  const cheapest = ratePayload?.cheapest_courier;
  if (cheapest && Number(cheapest.total) > 0) return cheapest;

  const couriers = Array.isArray(ratePayload?.couriers) ? ratePayload.couriers : [];
  const pickupFirst = couriers.filter((c) => String(c.service_type || '').toLowerCase() === 'pickup');
  const pool = pickupFirst.length ? pickupFirst : couriers;
  const priced = pool
    .map((c) => ({ ...c, amountNaira: Number(c.total ?? c.rate_card_amount) }))
    .filter((c) => Number.isFinite(c.amountNaira) && c.amountNaira > 0);
  if (!priced.length) return null;
  priced.sort((a, b) => a.amountNaira - b.amountNaira);
  return priced[0];
}
