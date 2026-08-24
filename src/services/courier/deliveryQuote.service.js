import { getAllStates, getDeliveryFee, resolveStateAndLGA } from '../location.service.js';
import { estimateWeightKg, toTerminalWeightKg } from './parcel.weight.js';
import {
  getDefaultPackaging,
  getShipmentQuotes,
  isTerminalConfigured,
  TerminalError,
} from './terminal.service.js';

export class DeliveryQuoteError extends Error {
  constructor(message, statusCode = 400, code = 'QUOTE_ERROR') {
    super(message);
    this.name = 'DeliveryQuoteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const PURPOSES = new Set(['renewal', 'plate_number', 'driver_license', 'guest_renewal']);
const quoteCache = new Map();
const QUOTE_TTL_MS = parseInt(process.env.TERMINAL_QUOTE_CACHE_MS || '600000', 10);
let packagingCache = { id: null, fetchedAt: 0 };
const PACKAGING_TTL_MS = 6 * 60 * 60 * 1000;

function nairaToKobo(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new DeliveryQuoteError('Courier returned an invalid shipping price', 502, 'INVALID_PRICE');
  }
  return Math.round(n * 100);
}

export function toE164Ng(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('234') && digits.length >= 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  return `+${digits}`;
}

export function splitPersonName(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || 'Customer',
    last_name: parts.slice(1).join(' ') || parts[0] || 'Customer',
  };
}

function requiredLine2(value, fallback) {
  const line = String(value || '').trim();
  return line || fallback;
}

export function pickupAddressPayload() {
  return {
    country: 'NG',
    state: process.env.TERMINAL_PICKUP_STATE || 'Lagos',
    city: process.env.TERMINAL_PICKUP_CITY || 'Ikeja',
    line1: process.env.TERMINAL_PICKUP_STREET || 'Motoka office',
    // Terminal requires line2 when persist_data=true (admin waybill booking).
    line2: requiredLine2(process.env.TERMINAL_PICKUP_LINE2, 'Office'),
    zip: process.env.TERMINAL_PICKUP_ZIP || '100001',
    email: process.env.TERMINAL_PICKUP_EMAIL || 'hello@motokaapp.ng',
    phone: toE164Ng(process.env.TERMINAL_PICKUP_PHONE || '08000000000'),
    first_name: process.env.TERMINAL_PICKUP_FIRSTNAME || 'Motoka',
    last_name: process.env.TERMINAL_PICKUP_LASTNAME || 'NG',
    name: process.env.TERMINAL_PICKUP_NAME || 'Motoka',
    is_residential: false,
  };
}

export function deliveryAddressPayload({
  stateName,
  city,
  street,
  contact,
  name,
  email,
} = {}) {
  const names = splitPersonName(name);
  return {
    country: 'NG',
    state: stateName,
    city: city || stateName,
    line1: street || city || stateName,
    line2: requiredLine2(process.env.TERMINAL_DEFAULT_LINE2, city || stateName || 'Nigeria'),
    zip: process.env.TERMINAL_DEFAULT_ZIP || '100001',
    phone: toE164Ng(contact) || toE164Ng(process.env.TERMINAL_PICKUP_PHONE || '08000000000'),
    email: email || process.env.TERMINAL_PICKUP_EMAIL || 'hello@motokaapp.ng',
    first_name: names.first_name,
    last_name: names.last_name,
    name: name || `${names.first_name} ${names.last_name}`.trim(),
    is_residential: true,
  };
}

export function parcelPayload({ purpose, weightKg, packagingId } = {}) {
  const weight = toTerminalWeightKg(weightKg);
  return {
    description: `Motoka ${purpose} delivery`,
    weight_unit: 'kg',
    weight,
    ...(packagingId ? { packaging: packagingId } : {}),
    items: [
      {
        name: `Motoka ${purpose}`,
        description: `Motoka ${purpose}`,
        type: 'parcel',
        currency: 'NGN',
        value: 1000,
        quantity: 1,
        weight,
      },
    ],
  };
}

export function pickCheapestNgnRate(rates) {
  const priced = (rates || [])
    .map((r) => ({
      ...r,
      amountNaira: Number(r.amount),
      currency: String(r.currency || 'NGN').toUpperCase(),
    }))
    .filter((r) => r.currency === 'NGN' && Number.isFinite(r.amountNaira) && r.amountNaira > 0);
  if (priced.length === 0) return null;
  priced.sort((a, b) => a.amountNaira - b.amountNaira);
  return priced[0];
}

export async function getPackagingId() {
  const fromEnv = String(process.env.TERMINAL_PACKAGING_ID || '').trim();
  if (fromEnv) return fromEnv;
  if (packagingCache.id && Date.now() - packagingCache.fetchedAt < PACKAGING_TTL_MS) {
    return packagingCache.id;
  }
  const pack = await getDefaultPackaging();
  const id = pack.packaging_id || pack.id;
  if (!id) throw new TerminalError('Terminal default packaging is missing', 502, 'API_ERROR');
  packagingCache = { id, fetchedAt: Date.now() };
  return id;
}

function cacheGet(key) {
  const hit = quoteCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > QUOTE_TTL_MS) {
    quoteCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (quoteCache.size > 500) {
    const oldest = quoteCache.keys().next().value;
    quoteCache.delete(oldest);
  }
  quoteCache.set(key, { at: Date.now(), value });
}

export async function quoteDelivery({
  stateInput,
  lgaInput,
  purpose = 'renewal',
  selectedItems = [],
  street,
  contact,
  name,
  email,
  persistData = false,
} = {}) {
  const normalizedPurpose = purpose === 'guest_renewal' ? 'renewal' : purpose;
  if (!PURPOSES.has(purpose) && !PURPOSES.has(normalizedPurpose)) {
    throw new DeliveryQuoteError('Invalid delivery purpose', 400, 'VALIDATION_ERROR');
  }

  const resolved = await resolveStateAndLGA(stateInput, lgaInput);
  if (!resolved.valid) {
    throw new DeliveryQuoteError(resolved.error || 'Invalid delivery location', 400, 'INVALID_LOCATION');
  }

  const motokaStates = await getAllStates();
  const motokaState = motokaStates.find((s) => s.code === resolved.stateCode);
  const stateName = motokaState?.name || resolved.stateCode;
  const weightKg = estimateWeightKg({ purpose: normalizedPurpose, selectedItems });

  if (!isTerminalConfigured()) {
    const feeKobo = Math.trunc(await getDeliveryFee(resolved.stateCode));
    return {
      fee_kobo: feeKobo,
      weight_kg: weightKg,
      stateCode: resolved.stateCode,
      lgaName: resolved.lgaName,
      provider: 'motoka',
      rate_id: null,
    };
  }

  const cacheKey = persistData
    ? null
    : `${resolved.stateCode}|${resolved.lgaName}|${weightKg}|${normalizedPurpose}`;
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  let packagingId = null;
  if (persistData) {
    packagingId = await getPackagingId();
  }

  let rates;
  try {
    rates = await getShipmentQuotes({
      pickupAddress: pickupAddressPayload(),
      deliveryAddress: deliveryAddressPayload({
        stateName,
        city: resolved.lgaName || stateName,
        street,
        contact,
        name,
        email,
      }),
      parcel: parcelPayload({
        purpose: normalizedPurpose,
        weightKg,
        packagingId,
      }),
      persistData,
    });
  } catch (error) {
    if (error instanceof TerminalError) {
      throw new DeliveryQuoteError(
        error.message || 'Could not get a live delivery quote. Try again or omit delivery.',
        error.statusCode || 502,
        error.code || 'API_ERROR'
      );
    }
    throw error;
  }

  const cheapest = pickCheapestNgnRate(rates);
  if (!cheapest) {
    throw new DeliveryQuoteError(
      'No Terminal carrier rates are available for this destination yet. Try another LGA or omit delivery.',
      400,
      'NO_RATES'
    );
  }

  const quote = {
    fee_kobo: nairaToKobo(cheapest.amountNaira),
    weight_kg: weightKg,
    stateCode: resolved.stateCode,
    lgaName: resolved.lgaName,
    provider: 'terminal',
    rate_id: persistData ? (cheapest.rate_id || cheapest.id) : null,
    carrier_name: cheapest.carrier_name || null,
    shipment_hint: persistData ? (cheapest.shipment || null) : null,
  };

  if (cacheKey) cacheSet(cacheKey, quote);
  return quote;
}

export async function quoteFromDeliveryFields(deliveryData, { purpose, selectedItems } = {}) {
  const address = deliveryData.address || deliveryData.delivery_address;
  const stateInput = deliveryData.state_id !== undefined && deliveryData.state_id !== null && deliveryData.state_id !== ''
    ? deliveryData.state_id
    : deliveryData.state;
  const lgaInput = deliveryData.lga_id !== undefined && deliveryData.lga_id !== null && deliveryData.lga_id !== ''
    ? deliveryData.lga_id
    : deliveryData.lga;
  const contact = deliveryData.contact || deliveryData.delivery_contact;

  if (!address || stateInput === undefined || stateInput === null || stateInput === '' || lgaInput === undefined || lgaInput === null || lgaInput === '' || !contact) {
    throw new DeliveryQuoteError(
      'Delivery details are incomplete. Provide address, state, lga, and contact, or omit delivery entirely.',
      400,
      'VALIDATION_ERROR'
    );
  }

  const quote = await quoteDelivery({
    stateInput,
    lgaInput,
    purpose,
    selectedItems,
    street: String(address).trim(),
    contact: String(contact).trim(),
    name: deliveryData.name,
    email: deliveryData.email,
  });

  return {
    ...quote,
    address: String(address).trim(),
    contact: String(contact).trim(),
  };
}
