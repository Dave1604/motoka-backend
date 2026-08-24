import { logError, logDebug } from '../../utils/logger.js';
import { retryWithBackoff } from '../../utils/retry.js';

export class TerminalError extends Error {
  constructor(message, statusCode = 502, code = 'TERMINAL_ERROR', data = null) {
    super(message);
    this.name = 'TerminalError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

export function getTerminalBaseUrl() {
  return (process.env.TERMINAL_BASE_URL || 'https://sandbox.terminal.africa/v1').replace(/\/$/, '');
}

export function isTerminalLiveApi() {
  return getTerminalBaseUrl().includes('api.terminal.africa');
}

export function isTerminalConfigured() {
  return Boolean(String(process.env.TERMINAL_SECRET_KEY || '').trim());
}

/** Live booking charges the Terminal wallet. Sandbox is allowed; live needs an explicit flag. */
export function isTerminalBookingEnabled() {
  if (!isTerminalConfigured()) return false;
  const flag = String(process.env.TERMINAL_BOOKING_ENABLED || '').toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return !isTerminalLiveApi();
}

function timeoutMs() {
  return parseInt(process.env.TERMINAL_REQUEST_TIMEOUT_MS || '15000', 10);
}

function maxRetries() {
  return parseInt(process.env.TERMINAL_MAX_RETRIES || '2', 10);
}

function requireConfig() {
  if (!isTerminalConfigured()) {
    throw new TerminalError(
      'Terminal Africa is not configured. Set TERMINAL_SECRET_KEY (sandbox key for test).',
      503,
      'CONFIG_ERROR'
    );
  }
}

async function terminalRequest(path, { method = 'GET', body, query } = {}) {
  requireConfig();

  const params = query
    ? `?${new URLSearchParams(
        Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== ''))
      ).toString()}`
    : '';
  const url = `${getTerminalBaseUrl()}${path.startsWith('/') ? path : `/${path}`}${params}`;

  const retries =
    method === 'POST' && path.includes('/shipments/pickup') ? 0 : maxRetries();

  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs());
      try {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${process.env.TERMINAL_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: body != null ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        let data = null;
        const text = await response.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
        }

        if (!response.ok || data?.status === false) {
          const message =
            data?.message ||
            data?.error ||
            `Terminal request failed (${response.status})`;
          logError('[Terminal] API error', { path, method, status: response.status, message });
          if (response.status === 401 || response.status === 403) {
            throw new TerminalError(
              'Delivery quoting is temporarily unavailable.',
              503,
              'CONFIG_ERROR'
            );
          }
          throw new TerminalError(
            message,
            response.status >= 500 ? 502 : 400,
            'API_ERROR',
            data
          );
        }

        logDebug('[Terminal] request ok', { path, method });
        return data;
      } catch (error) {
        if (error instanceof TerminalError) throw error;
        if (error.name === 'AbortError') {
          throw new TerminalError('Terminal request timed out', 504, 'REQUEST_TIMEOUT');
        }
        throw new TerminalError(
          error.message || 'Terminal request failed',
          502,
          'REQUEST_FAILED'
        );
      } finally {
        clearTimeout(timer);
      }
    },
    {
      maxRetries: retries,
      context: `Terminal ${method} ${path}`,
    }
  );
}

export async function createAddress(payload) {
  const data = await terminalRequest('/addresses', { method: 'POST', body: payload });
  return data?.data || data;
}

export async function createParcel(payload) {
  const data = await terminalRequest('/parcels', { method: 'POST', body: payload });
  return data?.data || data;
}

export async function getDefaultPackaging() {
  const data = await terminalRequest('/packaging/default/terminal', { method: 'GET' });
  return data?.data || data;
}

export async function getShipmentRates({ pickupAddressId, deliveryAddressId, parcelId, currency = 'NGN' }) {
  const data = await terminalRequest('/rates/shipment', {
    method: 'GET',
    query: {
      pickup_address: pickupAddressId,
      delivery_address: deliveryAddressId,
      parcel_id: parcelId,
      currency,
    },
  });
  return Array.isArray(data?.data) ? data.data : [];
}

/** persist_data=false is for price-only quotes and cannot be used to book. */
export async function getShipmentQuotes({
  pickupAddress,
  deliveryAddress,
  parcel,
  persistData = false,
  currency = 'NGN',
}) {
  const data = await terminalRequest('/rates/shipment/quotes', {
    method: 'POST',
    body: {
      pickup_address: pickupAddress,
      delivery_address: deliveryAddress,
      parcel,
      currency,
      persist_data: persistData,
    },
  });
  return Array.isArray(data?.data) ? data.data : [];
}

export async function arrangePickup({ rateId, shipmentId }) {
  const data = await terminalRequest('/shipments/pickup', {
    method: 'POST',
    body: {
      rate_id: rateId,
      ...(shipmentId ? { shipment_id: shipmentId } : {}),
    },
  });
  return data?.data || data;
}

export async function trackTerminalShipment(shipmentId) {
  const data = await terminalRequest(`/shipments/track/${encodeURIComponent(shipmentId)}`, {
    method: 'GET',
  });
  return data?.data || data;
}

export async function getTerminalShipment(shipmentId) {
  const data = await terminalRequest(`/shipments/${encodeURIComponent(shipmentId)}`, {
    method: 'GET',
  });
  return data?.data || data;
}
