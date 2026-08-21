import crypto from 'crypto';
import { logError, logInfo } from '../../../utils/logger.js';
import {
  ERROR_MESSAGES,
  PAYMENT_LIMITS,
  MONIPAY_ENDPOINTS,
} from '../../../constants/payment.constants.js';

const MONIPAY_BASE_URL = (process.env.MONIPAY_BASE_URL || 'https://api.monipay.ng').replace(/\/$/, '');

export class MonipayError extends Error {
  constructor(message, statusCode = 500, code = null, data = null) {
    super(message);
    this.name = 'MonipayError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

function getPublicKey() {
  return process.env.MONIPAY_PUBLIC_KEY || process.env.MONIPAY_SECRET_KEY;
}

function getSecretKey() {
  const key = process.env.MONIPAY_SECRET_KEY;
  if (!key) {
    throw new MonipayError('MONIPAY_SECRET_KEY not configured', 500, 'CONFIG_ERROR');
  }
  return key;
}

function unwrap(body) {
  if (!body || typeof body !== 'object') return {};
  return body.data && typeof body.data === 'object' ? body.data : body;
}

function isPaidStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'success' || s === 'successful' || s === 'approved' || s === 'paid';
}

async function monipayRequest(endpoint, { method = 'GET', body, useSecret = false } = {}) {
  const key = useSecret ? getSecretKey() : getPublicKey();
  if (!key) {
    throw new MonipayError('MONIPAY_PUBLIC_KEY or MONIPAY_SECRET_KEY not configured', 500, 'CONFIG_ERROR');
  }

  const url = `${MONIPAY_BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    logError('[Monipay] Request failed', { endpoint, error: error.message });
    throw new MonipayError(ERROR_MESSAGES.MONIPAY_API_ERROR, 500, 'REQUEST_FAILED', {
      originalError: error.message,
    });
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    logError('[Monipay] API error', {
      endpoint,
      status: response.status,
      message: payload.message || payload.error,
    });
    throw new MonipayError(
      payload.message || payload.error || ERROR_MESSAGES.MONIPAY_API_ERROR,
      response.status,
      'API_ERROR',
      payload
    );
  }

  return payload;
}

export async function initializeTransaction({
  email,
  amount,
  reference,
  callback_url,
  metadata = {},
  channels,
  first_name,
  last_name,
  phone,
}) {
  if (!email || !amount) {
    throw new MonipayError('Email and amount are required', 400, 'VALIDATION_ERROR');
  }
  if (amount < PAYMENT_LIMITS.MIN_AMOUNT) {
    throw new MonipayError(ERROR_MESSAGES.AMOUNT_TOO_LOW, 400, 'VALIDATION_ERROR');
  }

  const payload = {
    email,
    amount: Math.trunc(amount),
    currency: PAYMENT_LIMITS.DEFAULT_CURRENCY,
    metadata,
  };
  if (reference) payload.reference = reference;
  if (callback_url) {
    payload.callback_url = callback_url;
    payload.callbank = callback_url;
  }
  if (channels?.length) payload.channels = channels;
  if (first_name) payload.first_name = first_name;
  if (last_name) payload.last_name = last_name;
  if (phone) payload.phone = phone;

  const response = await monipayRequest(MONIPAY_ENDPOINTS.INITIALIZE, {
    method: 'POST',
    body: payload,
    useSecret: false,
  });
  const data = unwrap(response);

  const authorizationUrl = data.authorization_url || data.checkout_url || data.payment_url || null;
  const accessCode = data.access_code || data.accessCode || data.trans_id || data.transaction_id || null;
  const returnedReference = data.reference || data.order_id || reference;

  logInfo('[Monipay] Transaction initialized', { reference: returnedReference });

  return {
    authorization_url: authorizationUrl,
    access_code: accessCode,
    reference: returnedReference,
  };
}

export async function verifyTransaction(reference) {
  if (!reference) {
    throw new MonipayError('Reference is required', 400, 'VALIDATION_ERROR');
  }

  const response = await monipayRequest(
    `${MONIPAY_ENDPOINTS.VERIFY}/${encodeURIComponent(reference)}`,
    { method: 'GET', useSecret: true }
  );
  const data = unwrap(response);
  const status = data.status || data.payment_status || data.gateway_status;
  const paid = isPaidStatus(status) || data.success === true;

  logInfo('[Monipay] Transaction verified', {
    reference: data.reference || reference,
    status,
    amount: data.amount,
  });

  return {
    id: data.id || data.trans_id || data.transaction_id || null,
    reference: data.reference || data.order_id || reference,
    status: paid ? 'success' : String(status || 'pending').toLowerCase(),
    success: paid,
    amount: Number(data.amount) || 0,
    currency: data.currency || 'NGN',
    channel: data.channel || data.payment_channel || null,
    paid_at: data.paid_at || data.paidAt || data.date_paid || null,
    customer: data.customer || { email: data.email },
    authorization: data.authorization || null,
    metadata: data.metadata || {},
  };
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.MONIPAY_WEBHOOK_SECRET || process.env.MONIPAY_SECRET_KEY;
  if (!secret || !signature || rawBody == null) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  const bare = String(signature).replace(/^sha512=/i, '');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(bare, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseWebhookEvent(body = {}) {
  const event = body.event || body.type || body.status;
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const eventId = body.id || data.id || data.trans_id || `${event}:${data.reference || data.order_id || ''}`;
  return { event, data, eventId };
}

export { isPaidStatus };
