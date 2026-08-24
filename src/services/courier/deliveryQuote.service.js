import { getAllStates, getDeliveryFee, resolveStateAndLGA } from '../location.service.js';
import { estimateWeightKg, toTerminalWeightKg } from './parcel.weight.js';
import {
  isTerminalConfigured,
  TerminalError,
  getDefaultPackaging,
  getShipmentQuotes,
} from './terminal.service.js';
import {
  ShipbubbleError,
  createShipmentLabel,
  fetchShippingRates,
  isShipbubbleConfigured,
  nextPickupDate,
  pickCheapestShipbubbleCourier,
  resolveDocumentCategoryId,
  validateAddress,
} from './shipbubble.service.js';

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
const QUOTE_TTL_MS = parseInt(
  process.env.SHIPBUBBLE_QUOTE_CACHE_MS || process.env.TERMINAL_QUOTE_CACHE_MS || '600000',
  10
);
let packagingCache = { id: null, fetchedAt: 0 };
const PACKAGING_TTL_MS = 6 * 60 * 60 * 1000;
let pickupAddressCodeCache = { code: null, fetchedAt: 0 };
const ADDRESS_CODE_TTL_MS = 24 * 60 * 60 * 1000;

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

function envPickup(key, fallback) {
  return process.env[`SHIPBUBBLE_${key}`] || process.env[`TERMINAL_${key}`] || fallback;
}

export function pickupAddressPayload() {
  const first = envPickup('PICKUP_FIRSTNAME', 'Motoka');
  const last = envPickup('PICKUP_LASTNAME', 'NG');
  return {
    country: 'NG',
    state: envPickup('PICKUP_STATE', 'Ogun'),
    city: envPickup('PICKUP_CITY', 'Ijebu Ode'),
    line1: envPickup('PICKUP_STREET', 'Motoka office, Ijebu Ode'),
    line2: requiredLine2(envPickup('PICKUP_LINE2', 'Office'), 'Office'),
    zip: envPickup('PICKUP_ZIP', '120101'),
    email: envPickup('PICKUP_EMAIL', 'hello@motokaapp.ng'),
    phone: toE164Ng(envPickup('PICKUP_PHONE', '08000000000')),
    first_name: first,
    last_name: last,
    // Shipbubble requires a two-word full name (no numbers/symbols)
    name: envPickup('PICKUP_NAME', `${first} ${last}`.trim()),
    is_residential: false,
  };
}

export function pickupAddressString() {
  const p = pickupAddressPayload();
  return [p.line1, p.line2, p.city, p.state, 'Nigeria'].filter(Boolean).join(', ');
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
    line2: requiredLine2(process.env.TERMINAL_DEFAULT_LINE2 || process.env.SHIPBUBBLE_DEFAULT_LINE2, city || stateName || 'Nigeria'),
    zip: process.env.SHIPBUBBLE_DEFAULT_ZIP || process.env.TERMINAL_DEFAULT_ZIP || '100001',
    phone: toE164Ng(contact) || toE164Ng(envPickup('PICKUP_PHONE', '08000000000')),
    email: email || envPickup('PICKUP_EMAIL', 'hello@motokaapp.ng'),
    first_name: names.first_name,
    last_name: names.last_name,
    name: name || `${names.first_name} ${names.last_name}`.trim(),
    is_residential: true,
  };
}

export function deliveryAddressString({ stateName, city, street } = {}) {
  return [street, city, stateName, 'Nigeria'].filter(Boolean).join(', ');
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

export function shipbubblePackageItems({ purpose, weightKg } = {}) {
  const weight = Math.max(0.1, Number(weightKg) || 0.35);
  return [
    {
      name: `Motoka ${purpose}`,
      description: `Motoka ${purpose} documents`,
      unit_weight: String(weight),
      unit_amount: '1000',
      quantity: '1',
    },
  ];
}

export function shipbubblePackageDimension() {
  // Envelope / document pouch defaults (cm)
  return {
    length: Number(process.env.SHIPBUBBLE_PKG_LENGTH || 30),
    width: Number(process.env.SHIPBUBBLE_PKG_WIDTH || 22),
    height: Number(process.env.SHIPBUBBLE_PKG_HEIGHT || 3),
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

async function getShipbubblePickupAddressCode() {
  const fromEnv = String(process.env.SHIPBUBBLE_PICKUP_ADDRESS_CODE || '').trim();
  if (fromEnv) return Number(fromEnv) || fromEnv;

  if (pickupAddressCodeCache.code && Date.now() - pickupAddressCodeCache.fetchedAt < ADDRESS_CODE_TTL_MS) {
    return pickupAddressCodeCache.code;
  }

  const pickup = pickupAddressPayload();
  const validated = await validateAddress({
    name: pickup.name || `${pickup.first_name} ${pickup.last_name}`.trim(),
    email: pickup.email,
    phone: pickup.phone,
    address: pickupAddressString(),
  });
  const code = validated?.address_code;
  if (!code) {
    throw new ShipbubbleError('Could not validate Motoka pickup address with Shipbubble', 502, 'API_ERROR');
  }
  pickupAddressCodeCache = { code, fetchedAt: Date.now() };
  return code;
}

async function quoteViaShipbubble({
  stateName,
  lgaName,
  purpose,
  weightKg,
  street,
  contact,
  name,
  email,
  persistData,
}) {
  const delivery = deliveryAddressPayload({
    stateName,
    city: lgaName || stateName,
    street,
    contact,
    name,
    email,
  });

  const [senderCode, receiverValidated, categoryId] = await Promise.all([
    getShipbubblePickupAddressCode(),
    validateAddress({
      name: delivery.name,
      email: delivery.email,
      phone: delivery.phone,
      address: deliveryAddressString({
        stateName,
        city: lgaName || stateName,
        street: street || lgaName || stateName,
      }),
    }),
    resolveDocumentCategoryId(),
  ]);

  const receiverCode = receiverValidated?.address_code;
  if (!receiverCode) {
    throw new DeliveryQuoteError(
      'Could not validate the delivery address. Check the street, LGA, and state.',
      400,
      'INVALID_ADDRESS'
    );
  }

  const ratesPayload = await fetchShippingRates({
    senderAddressCode: senderCode,
    receiverAddressCode: receiverCode,
    categoryId,
    packageItems: shipbubblePackageItems({ purpose, weightKg }),
    packageDimension: shipbubblePackageDimension(),
    pickupDate: nextPickupDate(),
    serviceType: 'pickup',
    deliveryInstructions: `Motoka ${purpose} documents`,
  });

  const cheapest = pickCheapestShipbubbleCourier(ratesPayload);
  if (!cheapest) {
    throw new DeliveryQuoteError(
      'No Shipbubble courier rates are available for this destination yet. Try another LGA or omit delivery.',
      400,
      'NO_RATES'
    );
  }

  const amountNaira = Number(cheapest.total ?? cheapest.rate_card_amount ?? cheapest.amountNaira);
  return {
    fee_kobo: nairaToKobo(amountNaira),
    weight_kg: weightKg,
    provider: 'shipbubble',
    rate_id: persistData ? ratesPayload.request_token : null,
    carrier_name: cheapest.courier_name || null,
    courier_id: cheapest.courier_id ?? null,
    service_code: cheapest.service_code || null,
    request_token: persistData ? ratesPayload.request_token : null,
    shipment_hint: persistData
      ? {
          request_token: ratesPayload.request_token,
          courier_id: cheapest.courier_id,
          service_code: cheapest.service_code,
          total: amountNaira,
        }
      : null,
  };
}

async function quoteViaTerminal({
  stateName,
  lgaName,
  purpose,
  weightKg,
  street,
  contact,
  name,
  email,
  persistData,
}) {
  let packagingId = null;
  if (persistData) {
    packagingId = await getPackagingId();
  }

  const rates = await getShipmentQuotes({
    pickupAddress: pickupAddressPayload(),
    deliveryAddress: deliveryAddressPayload({
      stateName,
      city: lgaName || stateName,
      street,
      contact,
      name,
      email,
    }),
    parcel: parcelPayload({
      purpose,
      weightKg,
      packagingId,
    }),
    persistData,
  });

  const cheapest = pickCheapestNgnRate(rates);
  if (!cheapest) {
    throw new DeliveryQuoteError(
      'No Terminal carrier rates are available for this destination yet. Try another LGA or omit delivery.',
      400,
      'NO_RATES'
    );
  }

  return {
    fee_kobo: nairaToKobo(cheapest.amountNaira),
    weight_kg: weightKg,
    provider: 'terminal',
    rate_id: persistData ? (cheapest.rate_id || cheapest.id) : null,
    carrier_name: cheapest.carrier_name || null,
    shipment_hint: persistData ? (cheapest.shipment || null) : null,
  };
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

  const useShipbubble = isShipbubbleConfigured();
  const useTerminal = !useShipbubble && isTerminalConfigured();

  if (!useShipbubble && !useTerminal) {
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
    : `${useShipbubble ? 'sb' : 'ta'}|${resolved.stateCode}|${resolved.lgaName}|${weightKg}|${normalizedPurpose}`;
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  let quoteCore;
  try {
    if (useShipbubble) {
      quoteCore = await quoteViaShipbubble({
        stateName,
        lgaName: resolved.lgaName,
        purpose: normalizedPurpose,
        weightKg,
        street,
        contact,
        name,
        email,
        persistData,
      });
    } else {
      quoteCore = await quoteViaTerminal({
        stateName,
        lgaName: resolved.lgaName,
        purpose: normalizedPurpose,
        weightKg,
        street,
        contact,
        name,
        email,
        persistData,
      });
    }
  } catch (error) {
    if (error instanceof ShipbubbleError || error instanceof TerminalError) {
      throw new DeliveryQuoteError(
        error.message || 'Could not get a live delivery quote. Try again or omit delivery.',
        error.statusCode || 502,
        error.code || 'API_ERROR'
      );
    }
    if (error instanceof DeliveryQuoteError) throw error;
    throw error;
  }

  const quote = {
    ...quoteCore,
    stateCode: resolved.stateCode,
    lgaName: resolved.lgaName,
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

/** Book a Shipbubble label from a persisted quote hint / fresh rate fetch. */
export { createShipmentLabel, fetchShippingRates, validateAddress };
