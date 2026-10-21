import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * markGuestOrderPaid is reached twice for almost every guest payment: once by
 * the gateway webhook and once by the receipt page's verify call. On
 * 2026-10-13 both arrived before either had written payment_success, so the
 * customer got two receipts and ops two alerts. The UPDATE is now the claim:
 * whoever's write flips the row owns the side effects, the other returns
 * the order and does nothing.
 */

const sendReceipt = jest.fn(async () => {});
const sendOpsAlert = jest.fn(async () => {});
const updateSpy = jest.fn();
const linkUpdate = jest.fn(() => ({ eq: () => ({ error: null }) }));

jest.unstable_mockModule('../services/email/paymentEmail.service.js', () => ({
  sendGuestPaymentConfirmationEmail: sendReceipt,
}));
jest.unstable_mockModule('../services/email/adminOrderAlert.service.js', () => ({
  sendAdminGuestOrderAlert: sendOpsAlert,
}));
jest.unstable_mockModule('../services/payment/renewalItems.service.js', () => ({
  getRenewalItems: async () => [],
  validateRenewalItemsSelection: jest.fn(),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn(), logDebug: jest.fn(),
}));

const ORDER = {
  id: 'ord-1',
  payment_status: 'pending_payment',
  guest_email: 'guest@example.com',
  guest_name: 'Guest',
  guest_phone: '080',
  plate_number: 'ABC123XY',
  total_amount: 1500000,
  delivery_fee: 0,
  selected_items: [],
  receipt_token: 'tok',
};

// Table-aware stub: guest_renewal_orders.update() is the race; everything
// else (profiles lookup, linking) just needs to not throw.
jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    from: (table) => {
      if (table === 'guest_renewal_orders') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ORDER, error: null }) }) }),
          update: updateSpy,
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'user-1' }, error: null }) }) }),
        update: linkUpdate,
      };
    },
  }),
}));

const { markGuestOrderPaid } = await import('../services/guest/guestRenewal.service.js');

// The first UPDATE that reaches the stub wins the row; every later one finds
// payment_status already flipped and matches nothing — what Postgres does
// with the neq filter under concurrent writers.
function raceyUpdate() {
  let won = false;
  return jest.fn(() => ({
    eq: () => ({
      neq: () => ({
        select: () => ({
          maybeSingle: async () => {
            if (won) return { data: null, error: null };
            won = true;
            return { data: { id: ORDER.id }, error: null };
          },
        }),
      }),
      eq: () => ({ error: null }),
    }),
  }));
}

beforeEach(() => {
  sendReceipt.mockClear();
  sendOpsAlert.mockClear();
  updateSpy.mockReset();
  const impl = raceyUpdate();
  updateSpy.mockImplementation(impl);
});

describe('markGuestOrderPaid under a webhook/verify race', () => {
  it('sends one receipt and one ops alert when both callers arrive together', async () => {
    const [a, b] = await Promise.all([
      markGuestOrderPaid('PAY-1'),
      markGuestOrderPaid('PAY-1'),
    ]);

    expect(a).toMatchObject({ id: ORDER.id });
    expect(b).toMatchObject({ id: ORDER.id });
    expect(sendReceipt).toHaveBeenCalledTimes(1);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('a late repeat call after the row is paid does nothing', async () => {
    await markGuestOrderPaid('PAY-1');
    await markGuestOrderPaid('PAY-1');

    expect(sendReceipt).toHaveBeenCalledTimes(1);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });
});
