// Prices in kobo. Monicredit expects Naira — convert before API calls.
// vehicle_licence is required and cannot be deselected.
export const RENEWAL_ITEMS = {
  VEHICLE_LICENCE: {
    id: 'vehicle_licence',
    name: 'Vehicle Licence',
    price: 470000, // ₦4,700
    required: true
  },
  ROAD_WORTHINESS: {
    id: 'road_worthiness',
    name: 'Road Worthiness',
    price: 1500000, // ₦15,000
    required: false
  },
  INSURANCE: {
    id: 'insurance',
    name: 'Insurance',
    price: 1500000, // ₦15,000
    required: false
  },
  REFERRAL: {
    id: 'referral',
    name: 'Referral',
    price: 329000, // ₦3,290
    required: false
  },
  PROOF_OF_OWNERSHIP: {
    id: 'proof_of_ownership',
    name: 'Proof of Ownership',
    price: 100000, // ₦1,000
    required: false
  }
};

export const getAllRenewalItems = () => {
  return Object.values(RENEWAL_ITEMS);
};

export const calculateRenewalTotal = (selectedItemIds = []) => {
  if (!Array.isArray(selectedItemIds) || selectedItemIds.length === 0) {
    return 0;
  }
  
  const allItems = getAllRenewalItems();
  let total = 0;
  
  for (const itemId of selectedItemIds) {
    const item = allItems.find(i => i.id === itemId);
    if (item) {
      total += item.price;
    }
  }
  
  return total;
};

export const validateRenewalItems = (selectedItemIds = []) => {
  if (!Array.isArray(selectedItemIds) || selectedItemIds.length === 0) {
    return { valid: false, error: 'At least one renewal item must be selected' };
  }
  
  const allItems = getAllRenewalItems();
  const validIds = allItems.map(item => item.id);
  
  for (const itemId of selectedItemIds) {
    if (!validIds.includes(itemId)) {
      return { valid: false, error: `Invalid renewal item: ${itemId}` };
    }
  }
  
  const vehicleLicence = allItems.find(item => item.required);
  if (vehicleLicence && !selectedItemIds.includes(vehicleLicence.id)) {
    return { valid: false, error: `${vehicleLicence.name} is required and cannot be deselected` };
  }
  
  return { valid: true, total: calculateRenewalTotal(selectedItemIds) };
};

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  SUCCESSFUL: 'successful',
  FAILED: 'failed',
  ABANDONED: 'abandoned',
  REFUNDED: 'refunded'
};

export const PAYMENT_TYPE = {
  RENEWAL_MANUAL: 'renewal_manual',
  RENEWAL_AUTO: 'renewal_auto',
  NEW_REGISTRATION: 'new_registration',
  PLATE_NUMBER: 'plate_number',
  DRIVER_LICENSE: 'driver_license'
};

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  PENDING: 'pending'
};

export const SUBSCRIPTION_PLAN = {
  ANNUAL: 'annual',
  BIANNUAL: 'biannual',
  QUARTERLY: 'quarterly'
};

export const PLAN_MONTHS = {
  annual: 12,
  biannual: 6,
  quarterly: 3
};

export const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const ORDER_TYPE = {
  RENEWAL_MANUAL: 'renewal_manual',
  RENEWAL_AUTO: 'renewal_auto',
  NEW_REGISTRATION: 'new_registration',
  PLATE_NUMBER: 'plate_number',
  DRIVER_LICENSE: 'driver_license'
};

// All values in kobo. Monicredit expects Naira — divide by 100 at API boundary.
export const PAYMENT_LIMITS = {
  MIN_AMOUNT: 10000,        // ₦100
  MAX_AMOUNT: 100000000,    // ₦1,000,000
  DEFAULT_CURRENCY: 'NGN'
};

export const PAYMENT_GATEWAY = {
  PAYSTACK: 'paystack',
  MONICREDIT: 'monicredit'
};

export const PAYSTACK_EVENTS = {
  CHARGE_SUCCESS: 'charge.success',
  CHARGE_FAILED: 'charge.failed',
  TRANSFER_SUCCESS: 'transfer.success',
  TRANSFER_FAILED: 'transfer.failed',
  SUBSCRIPTION_CREATE: 'subscription.create',
  SUBSCRIPTION_DISABLE: 'subscription.disable',
  SUBSCRIPTION_NOT_RENEW: 'subscription.not_renew',
  INVOICE_CREATE: 'invoice.create',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  INVOICE_UPDATE: 'invoice.update',
  REFUND_PROCESSED: 'refund.processed',
  REFUND_FAILED: 'refund.failed'
};

export const PAYSTACK_ENDPOINTS = {
  INITIALIZE: '/transaction/initialize',
  VERIFY: '/transaction/verify',
  CHARGE_AUTHORIZATION: '/transaction/charge_authorization',
  LIST_TRANSACTIONS: '/transaction',
  REFUND: '/refund',
  RESOLVE_ACCOUNT: '/bank/resolve'
};

export const MONICREDIT_ENDPOINTS = {
  INITIALIZE: '/payment/transactions/init-transaction',
  VERIFY: '/payment/transactions/verify-transaction'
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  SERVER_ERROR: 500
};

export const ERROR_MESSAGES = {
  INVALID_AMOUNT: 'Invalid payment amount',
  AMOUNT_TOO_LOW: `Minimum payment amount is ${PAYMENT_LIMITS.MIN_AMOUNT / 100} NGN`,
  AMOUNT_TOO_HIGH: `Maximum payment amount is ${PAYMENT_LIMITS.MAX_AMOUNT / 100} NGN`,
  PAYMENT_NOT_FOUND: 'Payment transaction not found',
  PAYMENT_ALREADY_PROCESSED: 'This payment has already been processed',
  PAYMENT_FAILED: 'Payment failed',
  INVALID_REFERENCE: 'Invalid payment reference',
  DUPLICATE_REFERENCE: 'Payment reference already exists',
  
  PAYSTACK_INIT_FAILED: 'Failed to initialize payment',
  PAYSTACK_VERIFY_FAILED: 'Failed to verify payment',
  PAYSTACK_WEBHOOK_INVALID: 'Invalid webhook signature',
  PAYSTACK_API_ERROR: 'Paystack API error',
  
  MONICREDIT_INIT_FAILED: 'Failed to initialize Monicredit payment',
  MONICREDIT_VERIFY_FAILED: 'Failed to verify Monicredit payment',
  MONICREDIT_API_ERROR: 'Monicredit API error',
  INVALID_PAYMENT_GATEWAY: 'Invalid payment gateway selected',
  
  SUBSCRIPTION_NOT_FOUND: 'Subscription not found',
  SUBSCRIPTION_ALREADY_ACTIVE: 'An active subscription already exists for this car',
  SUBSCRIPTION_CANCELLED: 'This subscription has been cancelled',
  SUBSCRIPTION_EXPIRED: 'This subscription has expired',
  NO_AUTHORIZATION: 'No payment authorization found for recurring charge',
  
  ORDER_NOT_FOUND: 'Order not found',
  ORDER_ALREADY_PROCESSED: 'This order has already been processed',
  ORDER_CANCELLED: 'This order has been cancelled',
  INVALID_ORDER_STATUS: 'Invalid order status transition',
  
  CAR_NOT_FOUND: 'Car not found',
  UNAUTHORIZED: 'Unauthorized access',
  INVALID_REQUEST: 'Invalid request data'
};

export const SUCCESS_MESSAGES = {
  PAYMENT_INITIALIZED: 'Payment initialized successfully',
  PAYMENT_VERIFIED: 'Payment verified successfully',
  PAYMENT_SUCCESSFUL: 'Payment completed successfully',
  SUBSCRIPTION_CREATED: 'Subscription created successfully',
  SUBSCRIPTION_CANCELLED: 'Subscription cancelled successfully',
  SUBSCRIPTION_PAUSED: 'Subscription paused successfully',
  SUBSCRIPTION_RESUMED: 'Subscription resumed successfully',
  ORDER_CREATED: 'Order created successfully',
  ORDER_ASSIGNED: 'Order assigned successfully',
  ORDER_PROCESSING: 'Order processing started',
  ORDER_COMPLETED: 'Order completed successfully',
  ORDER_CANCELLED: 'Order cancelled successfully',
  WEBHOOK_PROCESSED: 'Webhook processed successfully'
};

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MIN_PAGE: 1,
  MAX_PAGE: 10000,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100
};

// Retry intervals in days from the previous attempt.
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_INTERVALS_DAYS: [3, 7, 14]
};

export const REFERENCE_PREFIX = {
  PAYMENT: 'PAY',
  SUBSCRIPTION: 'SUB',
  ORDER: 'ORD'
};

