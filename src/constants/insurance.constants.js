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

// ---------------------------------------------------------------------------
// ⚠️ CONFIRM BEFORE FIRST LIVE CALL
//
// Curacel's per-resource endpoint paths are only published inside their
// authenticated developer portal, so these are the documented resource names
// (Products, Customers, Quotations, Orders, Policies) mapped to conventional
// REST paths. They are deliberately isolated here so that correcting them is a
// one-file change — no service, controller or route code references a path
// string directly.
//
// On receiving a sandbox key: check each against docs.curacel.co and adjust.
// Everything else in this module is provider-shape agnostic.
// ---------------------------------------------------------------------------
export const CURACEL_ENDPOINTS = {
  PRODUCTS: '/products',
  CUSTOMERS: '/customers',
  QUOTATIONS: '/quotations',
  ORDERS: '/orders',
  POLICIES: '/policies'
};

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
  PROVIDER_UNAVAILABLE: 'Insurance provider is temporarily unavailable'
};
