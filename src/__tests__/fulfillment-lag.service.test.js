import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

let fixtures = {};

// Table-name → rows returned for the next awaited query. Each from() gets
// its own chain closing over its table: the service fires several queries
// concurrently (Promise.all), so a shared mutable "current table" would
// resolve every query with whichever from() ran last.
function queryFor(table) {
  // Emulate the two filters the service pushes down to the DB (grace
  // cutoffs and reference lists); everything else is bucketed in JS.
  const filters = [];
  const q = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    lt: jest.fn((field, value) => {
      filters.push({ op: 'lt', field, value });
      return q;
    }),
    in: jest.fn((field, values) => {
      filters.push({ op: 'in', field, values });
      return q;
    }),
    order: jest.fn(() => q),
    limit: jest.fn(() => q),
    then: (resolve) => {
      let rows = fixtures[table] || [];
      for (const f of filters) {
        if (f.op === 'lt') rows = rows.filter((r) => r[f.field] < f.value);
        if (f.op === 'in') rows = rows.filter((r) => f.values.includes(r[f.field]));
      }
      resolve({ data: rows, error: null });
    },
  };
  return q;
}

const chain = {
  from: jest.fn((table) => queryFor(table)),
};

const mockPaystackList = jest.fn();

jest.unstable_mockModule('../../src/config/supabase.js', () => ({
  getSupabaseAdmin: jest.fn(() => chain),
  getSupabaseUser: jest.fn(() => chain),
  getSupabase: jest.fn(() => chain),
}));

jest.unstable_mockModule('../../src/services/payment/paystack.service.js', () => ({
  listTransactions: (...args) => mockPaystackList(...args),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logDebug: jest.fn(),
}));

const { checkFulfillmentLag } = await import(
  '../../src/services/payment/fulfillment-lag.service.js'
);

describe('checkFulfillmentLag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fixtures = {
      payment_transactions: [],
      renewal_orders: [],
      guest_renewal_orders: [],
    };
    mockPaystackList.mockResolvedValue({ transactions: [], meta: { pageCount: 1 } });
  });

  it('flags old successful transactions with no order as orphans', async () => {
    fixtures.payment_transactions = [
      { id: 1, reference: 'PAY-OLD-1', amount: 1550000, paid_at: hoursAgo(5) },
    ];
    const result = await checkFulfillmentLag({ orphanGraceMinutes: 30 });
    expect(result.counts.orphan_successes).toBe(1);
    expect(result.orphan_successes[0]).toMatchObject({ reference: 'PAY-OLD-1' });
  });

  it('excludes recent successes (grace) and ones already linked to orders', async () => {
    fixtures.payment_transactions = [
      { id: 1, reference: 'PAY-FRESH', amount: 100, paid_at: hoursAgo(0.1) },
      { id: 2, reference: 'PAY-LINKED', amount: 100, paid_at: hoursAgo(5) },
    ];
    fixtures.renewal_orders = [{ transaction_id: 2 }];
    const result = await checkFulfillmentLag({ orphanGraceMinutes: 30 });
    expect(result.orphan_successes).toEqual([]);
  });

  it('flags stale pending and stalled processing orders, not fresh ones', async () => {
    fixtures.renewal_orders = [
      { id: 1, order_number: 'ORD-STALE', status: 'pending', created_at: hoursAgo(30), amount_paid: 10 },
      { id: 2, order_number: 'ORD-FRESH', status: 'pending', created_at: hoursAgo(2), amount_paid: 10 },
      { id: 3, order_number: 'ORD-STUCK', status: 'processing', created_at: hoursAgo(100), processing_started_at: hoursAgo(60), amount_paid: 10 },
      { id: 4, order_number: 'ORD-DONE', status: 'completed', created_at: hoursAgo(100), amount_paid: 10 },
    ];
    const result = await checkFulfillmentLag();
    // ORD-DONE is filtered by the status query in production; the mock
    // returns it, but the service only buckets pending/processing.
    expect(result.stale_new_orders.map((o) => o.order_number)).toEqual(['ORD-STALE']);
    expect(result.stalled_processing.map((o) => o.order_number)).toEqual(['ORD-STUCK']);
  });

  it('flags guest payments past the SLA only', async () => {
    fixtures.guest_renewal_orders = [
      { id: 1, guest_email: 'old@x.ng', payment_reference: 'PAY-G-OLD', total_amount: 100, updated_at: hoursAgo(30) },
      { id: 2, guest_email: 'new@x.ng', payment_reference: 'PAY-G-NEW', total_amount: 100, updated_at: hoursAgo(2) },
    ];
    const result = await checkFulfillmentLag({ guestStaleHours: 24 });
    expect(result.stale_guest_payments.map((g) => g.payment_reference)).toEqual(['PAY-G-OLD']);
  });

  it('skips the Paystack sweep unless reconcile=true', async () => {
    await checkFulfillmentLag({ reconcile: false });
    expect(mockPaystackList).not.toHaveBeenCalled();
  });

  it('reports ghost money: our-prefix Paystack successes with no local row', async () => {
    mockPaystackList.mockResolvedValue({
      transactions: [
        { reference: 'PAY-GHOST-1', amount: 1550000, customer: { email: 'a@x.ng' }, paid_at: hoursAgo(3) },
        { reference: 'PAY-KNOWN-1', amount: 100, customer: {}, paid_at: hoursAgo(3) },
        { reference: 'txn_foreign', amount: 999, customer: {}, paid_at: hoursAgo(3) },
      ],
      meta: { pageCount: 1 },
    });
    fixtures.payment_transactions = [{ reference: 'PAY-KNOWN-1' }];
    fixtures.guest_renewal_orders = [];
    const result = await checkFulfillmentLag({ reconcile: true });
    expect(mockPaystackList).toHaveBeenCalled();
    expect(result.reconciled_with_paystack).toBe(true);
    expect(result.ghost_money.map((g) => g.reference)).toEqual(['PAY-GHOST-1']);
  });
});
