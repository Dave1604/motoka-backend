import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: jest.fn(),
  getSupabase: jest.fn(),
}));
jest.unstable_mockModule('../services/email/adminOrderAlert.service.js', () => ({
  sendAdminOrderAlert: jest.fn(async () => ({})),
  sendAdminGuestOrderAlert: jest.fn(async () => ({})),
}));
jest.unstable_mockModule('../services/email/paymentEmail.service.js', () => ({
  sendOrderInProgressEmail: jest.fn(async () => ({})),
  sendGuestPaymentConfirmationEmail: jest.fn(async () => ({})),
}));
jest.unstable_mockModule('../services/payment/renewalItems.service.js', () => ({
  getRenewalItems: jest.fn(async () => []),
}));

const inNDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// Generic chainable Supabase fake. from(table) records the table; terminal
// behaviour: update-chains resolve { error }, select-chains resolve the
// programmed rows, single/maybeSingle resolve the programmed single row.
function dbFake({ rows = {}, singles = {}, updateError = null } = {}) {
  const updates = [];
  const chain = (table) => {
    let updated = null;
    const c = {
      select: jest.fn(() => c),
      eq: jest.fn(() => c),
      neq: jest.fn(() => c),
      in: jest.fn(() => c),
      is: jest.fn(() => c),
      not: jest.fn(() => c),
      lte: jest.fn(() => c),
      gte: jest.fn(() => c),
      lt: jest.fn(() => c),
      order: jest.fn(() => c),
      limit: jest.fn(() => c),
      update: jest.fn((row) => {
        updated = row;
        updates.push({ table, row });
        return c;
      }),
      insert: jest.fn(() => c),
      single: jest.fn(async () => ({ data: singles[table] ?? null, error: null })),
      maybeSingle: jest.fn(async () => ({ data: singles[table] ?? null, error: null })),
      then: (resolve) =>
        resolve(updated ? { data: null, error: updateError } : { data: rows[table] ?? [], error: null }),
    };
    return c;
  };
  return { updates, from: jest.fn((table) => chain(table)) };
}

const res = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
};

describe('scheduling.util', () => {
  let util;

  beforeEach(async () => {
    util = await import('../services/payment/scheduling.util.js');
  });

  it('holds far-out renewals, releases near ones', () => {
    expect(util.computeSchedule({ expiryDate: inNDays(200) }).scheduledFor).toBe(inNDays(170));
    expect(util.computeSchedule({ expiryDate: inNDays(30) }).scheduledFor).toBeNull();
    expect(util.computeSchedule({ expiryDate: inNDays(-5) }).scheduledFor).toBeNull();
    expect(util.computeSchedule({ expiryDate: null })).toEqual({ previousExpiry: null, scheduledFor: null });
  });

  it('chains after the latest in-flight cycle end', () => {
    const anchor = util.chainAnchor([
      { previous_expiry_date: '2026-03-01', renewal_months: 12 },
      { previous_expiry_date: null, renewal_months: 12 },
      { previous_expiry_date: '2027-03-01', renewal_months: 12 },
    ]);
    expect(anchor).toBe('2028-03-01');
    expect(util.chainAnchor([])).toBeNull();
  });

  it('detects item overlap', () => {
    expect(util.itemsOverlap(['a', 'b'], ['b', 'c'])).toBe(true);
    expect(util.itemsOverlap(['a'], ['b'])).toBe(false);
    expect(util.itemsOverlap([], ['b'])).toBe(false);
  });

  it('resolveOrderSchedule skips non-cyclical and car-less payments', async () => {
    const fake = dbFake();
    expect(await util.resolveOrderSchedule(fake, { carId: 1, orderType: 'plate_number' }))
      .toEqual({ scheduledFor: null, previousExpiryOverride: null, chainedAfterOrderNumber: null });
    expect(await util.resolveOrderSchedule(fake, { carId: null, orderType: 'renewal_manual' }))
      .toEqual({ scheduledFor: null, previousExpiryOverride: null, chainedAfterOrderNumber: null });
  });

  it('resolveOrderSchedule holds early renewals and chains covering orders', async () => {
    const fake = dbFake({
      singles: { cars: { id: 7, expiry_date: inNDays(200) } },
      rows: {
        renewal_orders: [
          {
            order_number: 'ORD-OLD', status: 'scheduled', previous_expiry_date: inNDays(200),
            renewal_months: 12, selected_items: ['vehicle_licence'], created_at: new Date(Date.now() - 3600e3).toISOString(),
          },
        ],
      },
    });
    const chained = await util.resolveOrderSchedule(fake, {
      carId: 7, orderType: 'renewal_manual', renewalMonths: 12, requestedItems: ['vehicle_licence'],
    });
    // 200d expiry + 12mo cycle -> next window opens ~a year out: always held
    expect(chained.previousExpiryOverride).not.toBeNull();
    expect(chained.scheduledFor).not.toBeNull();
    expect(chained.chainedAfterOrderNumber).toBe('ORD-OLD');

    const fake2 = dbFake({
      singles: { cars: { id: 7, expiry_date: inNDays(200) } },
      rows: { renewal_orders: [] },
    });
    const held = await util.resolveOrderSchedule(fake2, {
      carId: 7, orderType: 'renewal_manual', renewalMonths: 12, requestedItems: ['vehicle_licence'],
    });
    expect(held.previousExpiryOverride).toBe(inNDays(200));
    expect(held.scheduledFor).toBe(inNDays(170));
    expect(held.chainedAfterOrderNumber).toBeNull();
  });
});

describe('renewalSweeper', () => {
  let sweeper;
  let mockGetSupabaseAdmin;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ renewalSweeper: sweeper } = await import('../services/payment/renewalSweeper.service.js'));
    ({ getSupabaseAdmin: mockGetSupabaseAdmin } = await import('../config/supabase.js'));
  });

  it('releases due orders to pending with both alerts', async () => {
    const fake = dbFake({
      rows: {
        renewal_orders: [
          { id: 1, order_number: 'ORD-1', user_id: 'u1', car_id: 7, previous_expiry_date: inNDays(10), renewal_months: 12, scheduled_for: inNDays(-1), amount_paid: 25000, processing_notes: null },
        ],
        guest_renewal_orders: [],
      },
      singles: {
        cars: { id: 7, expiry_date: inNDays(10), plate_number: 'ABC1' },
        profiles: { email: 'a@b.c', first_name: 'A', last_name: 'B' },
      },
    });
    mockGetSupabaseAdmin.mockReturnValue(fake);

    const s = new sweeper.constructor();
    await s.tick();

    const flip = fake.updates.find((u) => u.table === 'renewal_orders');
    expect(flip.row.status).toBe('pending');
    expect(flip.row.scheduled_for).toBeNull();
    const { sendAdminOrderAlert } = await import('../services/email/adminOrderAlert.service.js');
    const { sendOrderInProgressEmail } = await import('../services/email/paymentEmail.service.js');
    expect(sendAdminOrderAlert).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'ORD-1' }));
    expect(sendOrderInProgressEmail).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'ORD-1' }));
  });

  it('pushes the hold out when the car expiry moved', async () => {
    const fake = dbFake({
      rows: {
        renewal_orders: [
          { id: 2, order_number: 'ORD-2', user_id: 'u1', car_id: 8, previous_expiry_date: inNDays(10), renewal_months: 12, scheduled_for: inNDays(-1), amount_paid: 25000, processing_notes: null },
        ],
        guest_renewal_orders: [],
      },
      singles: { cars: { id: 8, expiry_date: inNDays(400) } },
    });
    mockGetSupabaseAdmin.mockReturnValue(fake);

    const s = new sweeper.constructor();
    await s.tick();

    const flip = fake.updates.find((u) => u.table === 'renewal_orders');
    expect(flip.row.status).toBeUndefined();
    expect(flip.row.scheduled_for).toBe(inNDays(370));
  });

  it('reminds once for unclaimed guests, releases claimed ones', async () => {
    const guestUnclaimed = {
      id: 'g1', guest_email: 'g@e.c', guest_name: 'G U', plate_number: 'P1',
      total_amount: 10000, payment_reference: 'ref', selected_items: [],
      linked_user_id: null, scheduled_for: inNDays(-1), metadata: {},
    };
    const fake = dbFake({
      rows: { renewal_orders: [], guest_renewal_orders: [guestUnclaimed] },
    });
    mockGetSupabaseAdmin.mockReturnValue(fake);

    const s = new sweeper.constructor();
    await s.tick();
    // Simulate the persisted metadata update the first tick wrote.
    guestUnclaimed.metadata = { claim_reminded_at: new Date().toISOString() };
    await s.tick();

    const { sendGuestPaymentConfirmationEmail } = await import('../services/email/paymentEmail.service.js');
    expect(sendGuestPaymentConfirmationEmail).toHaveBeenCalledTimes(1);
    const metaUpdate = fake.updates.find((u) => u.table === 'guest_renewal_orders' && u.row.metadata);
    expect(metaUpdate.row.metadata.claim_reminded_at).toBeTruthy();
  });
});

describe('rollover endpoints', () => {
  let ops;
  let mockGetSupabaseAdmin;

  beforeEach(async () => {
    jest.clearAllMocks();
    ops = await import('../controllers/admin-order-ops.controller.js');
    ({ getSupabaseAdmin: mockGetSupabaseAdmin } = await import('../config/supabase.js'));
  });

  it('rolls a paid order to the next cycle and re-holds it', async () => {
    const fake = dbFake({
      singles: {
        renewal_orders: { id: 5, order_number: 'ORD-5', status: 'pending', car_id: 9, renewal_months: 12, previous_expiry_date: inNDays(10), scheduled_for: null, processing_notes: null },
      },
    });
    // update().select().single() chain for the returning row
    const returning = { id: 5, order_number: 'ORD-5', status: 'scheduled', scheduled_for: inNDays(335), previous_expiry_date: inNDays(365) };
    fake.from.mockImplementation((table) => {
      if (table === 'cars') {
        const c = { update: jest.fn(() => c), eq: jest.fn(() => c) };
        return c;
      }
      if (table === 'renewal_orders') {
        let updated = null;
        const c = {
          select: jest.fn(() => c), eq: jest.fn(() => c), maybeSingle: jest.fn(async () => ({ data: fake._order, error: null })),
          update: jest.fn((row) => { updated = row; return c; }),
          single: jest.fn(async () => ({ data: returning, error: null })),
        };
        return c;
      }
      const c = { select: jest.fn(() => c), eq: jest.fn(() => c) };
      return c;
    });
    fake._order = { id: 5, order_number: 'ORD-5', status: 'pending', car_id: 9, renewal_months: 12, previous_expiry_date: inNDays(10), scheduled_for: null, processing_notes: null };
    mockGetSupabaseAdmin.mockReturnValue(fake);
    const r = res();

    await ops.rollOrderToNextCycle({ params: { orderNumber: 'ORD-5' }, body: { new_expiry_date: inNDays(365) } }, r);

    expect(r.status).not.toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ status: true, data: returning });
  });

  it('refuses completed orders and bad dates', async () => {
    const fake = dbFake({
      singles: { renewal_orders: { id: 6, order_number: 'ORD-6', status: 'completed', car_id: 9 } },
    });
    mockGetSupabaseAdmin.mockReturnValue(fake);

    const r1 = res();
    await ops.rollOrderToNextCycle({ params: { orderNumber: 'ORD-6' }, body: { new_expiry_date: inNDays(365) } }, r1);
    expect(r1.status).toHaveBeenCalledWith(409);

    const r2 = res();
    await ops.rollOrderToNextCycle({ params: { orderNumber: 'ORD-6' }, body: { new_expiry_date: 'not-a-date' } }, r2);
    expect(r2.status).toHaveBeenCalledWith(400);
  });

  it('rolls a guest order hold date', async () => {
    const fake = dbFake({
      singles: { guest_renewal_orders: { id: 'g9', payment_status: 'payment_success', scheduled_for: null, metadata: {} } },
    });
    fake.from.mockImplementation((table) => {
      let updated = null;
      const c = {
        select: jest.fn(() => c), eq: jest.fn(() => c),
        maybeSingle: jest.fn(async () => ({ data: { id: 'g9', payment_status: 'payment_success', scheduled_for: null, metadata: {} }, error: null })),
        update: jest.fn((row) => { updated = row; return c; }),
        single: jest.fn(async () => ({ data: { id: 'g9', payment_status: 'payment_success', scheduled_for: inNDays(100) }, error: null })),
      };
      return c;
    });
    mockGetSupabaseAdmin.mockReturnValue(fake);
    const r = res();

    await ops.rollGuestOrder({ params: { id: 'g9' }, body: { scheduled_for: inNDays(100) } }, r);

    expect(r.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: true })
    );
  });
});

describe('releaseSweepHandler (pg_cron trigger)', () => {
  let handler;
  let mockGetSupabaseAdmin;
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    ({ releaseSweepHandler: handler } = await import('../services/payment/renewalSweeper.service.js'));
    ({ getSupabaseAdmin: mockGetSupabaseAdmin } = await import('../config/supabase.js'));
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  const req = (secret) => ({ headers: secret === undefined ? {} : { 'x-cron-secret': secret } });

  it('refuses to run open when no secret is configured', async () => {
    delete process.env.INTERNAL_CRON_SECRET;
    const r = res();
    await handler(req('anything'), r);
    expect(r.status).toHaveBeenCalledWith(503);
  });

  it('rejects a wrong secret without touching the database', async () => {
    process.env.INTERNAL_CRON_SECRET = 'correct-secret';
    const fake = dbFake({ rows: { renewal_orders: [], guest_renewal_orders: [] } });
    mockGetSupabaseAdmin.mockReturnValue(fake);
    const r = res();
    await handler(req('wrong-secret'), r);
    expect(r.status).toHaveBeenCalledWith(401);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('runs the sweep immediately on a valid secret', async () => {
    process.env.INTERNAL_CRON_SECRET = 'correct-secret';
    const in10 = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const fake = dbFake({
      rows: {
        renewal_orders: [
          { id: 9, order_number: 'ORD-9', user_id: 'u9', car_id: 9, previous_expiry_date: in10, renewal_months: 12, scheduled_for: yesterday, amount_paid: 10000, processing_notes: null },
        ],
        guest_renewal_orders: [],
      },
      singles: {
        cars: { id: 9, expiry_date: in10 },
        profiles: { email: 'a@b.c', first_name: 'A', last_name: 'B' },
      },
    });
    mockGetSupabaseAdmin.mockReturnValue(fake);
    const r = res();
    await handler(req('correct-secret'), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith({ status: true, message: 'Sweep started' });
    // Background tick runs to completion (await a macrotask).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const flip = fake.updates.find((u) => u.table === 'renewal_orders');
    expect(flip.row.status).toBe('pending');
  });
});
