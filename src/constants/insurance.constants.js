// Curacel Grow — embedded insurance provider.
//
// Base URLs are from Curacel's published docs. The endpoint *structure* is
// identical between environments; only the host differs, and each environment
// needs its own API key (a live key will not work against sandbox).
//   https://docs.curacel.co/docs/guides/curacel-grow/get-started/api-key/
export const CURACEL_BASE_URL = {
  sandbox: 'https://api.playbox.grow.curacel.co/api',
  production: 'https://api.grow.curacel.co/api'
};

// Paths verified against the sandbox on 2026-10-16 (products, customers,
// attachments, quotes, quotes/accept, orders, policies all exercised end to
// end). The published OpenAPI spec is at docs.curacel.co/openapi/curacel-grow.yaml.
export const CURACEL_ENDPOINTS = {
  PRODUCTS: '/v1/products',
  CUSTOMERS: '/v1/customers',
  ATTACHMENTS: '/v1/attachments',
  QUOTES: '/v1/quotes',
  ACCEPT_QUOTE: '/v1/quotes/accept',
  ORDERS: '/v1/orders',
  POLICIES: '/v1/policies'
};

// Curacel's product_type.slug for the two motor covers. Product codes differ
// per partner and per environment, so products are matched on type, not code.
export const CURACEL_MOTOR_TYPE_SLUG = {
  third_party: '3rd_party_auto',
  comprehensive: 'comprehensive_auto'
};

// Curacel's vehicle_class enum is car | sedan | suv. Our cars table only
// records private/commercial, so everything goes up as "car" until we capture
// body type.
export const CURACEL_DEFAULT_VEHICLE_CLASS = 'car';

// Motor cover types we surface to the customer. Third-party is the legal
// minimum and the one bundled into a standard renewal; comprehensive is the
// upsell and carries materially better commission.
export const COVER_TYPE = {
  THIRD_PARTY: 'third_party',
  COMPREHENSIVE: 'comprehensive'
};

// A policy is not "real" until it lands on the NIID — that is the database
// FRSC, the police and VIS actually check at a stop. A certificate that is not
// on NIID is worthless to the customer no matter what it looks like, so this
// is tracked explicitly rather than assumed from a successful purchase.
export const NIID_STATUS = {
  PENDING: 'pending',
  REGISTERED: 'registered',
  FAILED: 'failed'
};

export const POLICY_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
};

export const INSURANCE_ERROR_MESSAGES = {
  NOT_CONFIGURED: 'Insurance provider is not configured',
  QUOTE_FAILED: 'Could not retrieve an insurance quote',
  PURCHASE_FAILED: 'Could not complete the insurance purchase',
  POLICY_NOT_FOUND: 'No insurance policy found for this vehicle',
  INVALID_COVER_TYPE: 'Invalid cover type',
  PROVIDER_UNAVAILABLE: 'Insurance provider is temporarily unavailable',
  LICENCE_REQUIRED: "Add your driver's licence before requesting insurance",
  VEHICLE_INCOMPLETE: 'Vehicle details are incomplete',
  VEHICLE_VALUE_REQUIRED: 'Vehicle value is required for comprehensive cover',
  PROFILE_INCOMPLETE: 'Add your residential address to your profile first'
};
