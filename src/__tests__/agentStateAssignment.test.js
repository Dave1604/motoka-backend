import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// A small in-memory stand-in for the Supabase client. Filters really filter, so
// these tests fail if a query stops scoping by state, agent or status.
let db;
let nextId;

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.action = 'select';
    this.payload = null;
    this.single_ = false;
  }
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  eq(col, val) { this.filters.push((r) => String(r[col]) === String(val)); return this; }
  is(col, val) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  in(col, vals) { this.filters.push((r) => vals.map(String).includes(String(r[col]))); return this; }
  neq(col, val) { this.filters.push((r) => String(r[col]) !== String(val)); return this; }
  gte() { return this; }
  lte() { return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  single() { this.single_ = true; return this; }
  maybeSingle() { this.single_ = true; return this; }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  run() {
    const rows = (db[this.table] = db[this.table] || []);
    const match = (r) => this.filters.every((f) => f(r));
    let out;
    if (this.action === 'insert') {
      out = [this.payload].flat().map((p) => ({ id: `new-${nextId++}`, assigned_at: new Date(2030, 0, nextId).toISOString(), ...p }));
      rows.push(...out);
    } else if (this.action === 'update') {
      out = rows.filter(match);
      out.forEach((r) => Object.assign(r, this.payload));
    } else if (this.action === 'delete') {
      out = rows.filter(match);
      db[this.table] = rows.filter((r) => !match(r));
    } else {
      out = rows.filter(match);
    }
    return { data: this.single_ ? (out[0] ? { ...out[0] } : null) : out.map((r) => ({ ...r })), error: null };
  }
}

const mockSendEmail = jest.fn().mockResolvedValue({});
let mockStorage;
let mockUploadError;

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    from: (table) => new FakeQuery(table),
    storage: {
      from: (bucket) => ({
        upload: async (path, _buffer, options) => {
          if (mockUploadError) return { error: { message: mockUploadError } };
          mockStorage.uploads.push({ bucket, path, options });
          return { error: null };
        },
        remove: async (paths) => {
          mockStorage.removed.push(...paths);
          return { error: null };
        },
        createSignedUrl: async (path, expiresIn) => ({
          data: { signedUrl: `https://signed.example/${bucket}/${path}?expires=${expiresIn}` },
          error: null,
        }),
      }),
    },
  }),
}));
jest.unstable_mockModule('../services/email/email.service.js', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

const { resolveOrderState, orderServiceAmountKobo, computeOrderCost } = await import('../services/agents/agentCost.service.js');
const { withholdReasonFor, retryPayout, markPaidManually } = await import('../services/agents/agentPayout.service.js');
const { pickAgent, runAgentPipeline, reassignOrder, assignOrderManually, releaseAgentFromCancelledOrder } = await import('../services/agents/agentPipeline.service.js');
const { canTransition, setAgentWorkStatus, completeAgentWork, isOrderOnHold } = await import('../services/agents/agentWork.service.js');
const { summarisePayouts, createAgent, updateAgent, getAgentNinUrl, getAgentOrders, summariseAgentOrders } = await import('../controllers/adminAgents.controller.js');

const { resolveBankAccount } = await import('../controllers/payment/paymentMethods.controller.js');

const { updateGuestOrderStatus, updateOrderStatus, reopenOrder, reopenGuestOrder } = await import('../controllers/admin.controller.js');

const fakeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const ninFile = (mimetype = 'image/jpeg') => [{ buffer: Buffer.from('x'), mimetype, originalname: 'nin.jpg' }];

const agent = (id, extra = {}) => ({
  id, name: id, status: 'active', account_number: '0123456789', bank_code: '058', account_name: id, ...extra,
});
const cost = (service_key, state, cost_kobo) => ({
  service_type: 'renewal_item', service_key, state, cost_kobo, active: true,
});
const guestOrder = (extra = {}) => ({
  id: 'g1',
  selected_items: ['road_worthiness'],
  renewal_state: 'Lagos',
  renewal_amount: 2000000,
  delivery_fee: 500000,
  total_amount: 2500000,
  assigned_agent_id: null,
  ...extra,
});

beforeEach(() => {
  db = {};
  nextId = 1;
  mockSendEmail.mockClear();
  mockStorage = { uploads: [], removed: [] };
  mockUploadError = null;
  process.env.AGENT_PAYOUT_ALERT_EMAILS = 'ops@example.com';
  delete process.env.AGENT_PAYOUTS_ENABLED;
});

describe('resolveOrderState', () => {
  it('prefers the renewal state the customer chose', async () => {
    expect(await resolveOrderState({ order: { renewal_state: 'Lagos', delivery_state: 'OG' } })).toBe('Lagos');
  });

  it('reads the renewal state from metadata when the column is empty', async () => {
    expect(await resolveOrderState({ order: { metadata: { renewal_state: 'Ogun' } } })).toBe('Ogun');
  });

  it('turns a delivery state code into its name for plate and licence orders', async () => {
    db.states = [{ code: 'OG', name: 'Ogun' }];
    expect(await resolveOrderState({ order: { delivery_state: 'og' } })).toBe('Ogun');
  });

  it('uses a guest delivery state that is already a name', async () => {
    expect(await resolveOrderState({ order: { delivery_details: { state: 'Lagos' } } })).toBe('Lagos');
  });

  it('returns null when the order has no state', async () => {
    expect(await resolveOrderState({ order: {} })).toBeNull();
  });
});

describe('orderServiceAmountKobo', () => {
  it('uses renewal_amount, which excludes delivery', () => {
    expect(orderServiceAmountKobo({ orderType: 'guest', order: guestOrder() })).toBe(2000000);
  });

  it('removes delivery when renewal_amount fell back to the full payment', () => {
    const order = { renewal_amount: 2500000, amount_paid: 2500000, delivery_fee: 500000 };
    expect(orderServiceAmountKobo({ orderType: 'regular', order })).toBe(2000000);
  });

  it('works from the amount paid when renewal_amount is missing', () => {
    const order = { amount_paid: '1500000.00', delivery_fee: 0 };
    expect(orderServiceAmountKobo({ orderType: 'regular', order })).toBe(1500000);
  });

  it('returns null when the order records no amounts', () => {
    expect(orderServiceAmountKobo({ orderType: 'regular', order: {} })).toBeNull();
  });
});

describe('computeOrderCost', () => {
  it('uses the cost for the order state over the default', async () => {
    db.agent_service_costs = [cost('road_worthiness', 'default', 500000), cost('road_worthiness', 'Lagos', 1200000)];
    const result = await computeOrderCost({ orderType: 'guest', order: guestOrder() });
    expect(result.totalKobo).toBe(1200000);
    expect(result.costs[0].cost_source).toBe('Lagos');
    expect(result.profitKobo).toBe(800000);
  });

  it('falls back to the default cost for a state with no row', async () => {
    db.agent_service_costs = [cost('road_worthiness', 'default', 500000), cost('road_worthiness', 'Lagos', 1200000)];
    const result = await computeOrderCost({ orderType: 'guest', order: guestOrder({ renewal_state: 'Ogun' }) });
    expect(result.totalKobo).toBe(500000);
    expect(result.costs[0].cost_source).toBe('default');
  });

  it('leaves profit empty while a cost is missing', async () => {
    db.agent_service_costs = [cost('road_worthiness', 'default', 500000)];
    const order = guestOrder({ selected_items: ['road_worthiness', 'insurance'] });
    const result = await computeOrderCost({ orderType: 'guest', order });
    expect(result.missing).toEqual([{ service_type: 'renewal_item', service_key: 'insurance' }]);
    expect(result.profitKobo).toBeNull();
  });
});

describe('withholdReasonFor', () => {
  it('holds a payout that would leave Motoka no profit', () => {
    process.env.AGENT_PAYOUTS_ENABLED = 'true';
    expect(withholdReasonFor({ amountKobo: 100, missing: [], profitKobo: 0 })).toBe('no_profit:0');
    expect(withholdReasonFor({ amountKobo: 100, missing: [], profitKobo: -50 })).toBe('no_profit:-50');
  });

  it('allows a profitable payout when payouts are on', () => {
    process.env.AGENT_PAYOUTS_ENABLED = 'true';
    expect(withholdReasonFor({ amountKobo: 100, missing: [], profitKobo: 50 })).toBeNull();
  });

  it('holds everything while payouts are off', () => {
    expect(withholdReasonFor({ amountKobo: 100, missing: [], profitKobo: 50 })).toBe('payouts_disabled');
  });
});

describe('pickAgent', () => {
  beforeEach(() => {
    db.agents = [agent('lagos-1'), agent('lagos-2'), agent('ogun-1'), agent('lagos-off', { status: 'inactive' })];
    db.agent_states = [
      { agent_id: 'lagos-1', state: 'Lagos' },
      { agent_id: 'lagos-2', state: 'Lagos' },
      { agent_id: 'lagos-off', state: 'Lagos' },
      { agent_id: 'ogun-1', state: 'Ogun' },
    ];
  });

  it('only picks active agents covering the state', async () => {
    expect((await pickAgent({ state: 'Ogun' })).id).toBe('ogun-1');
    expect(['lagos-1', 'lagos-2']).toContain((await pickAgent({ state: 'Lagos' })).id);
  });

  it('takes turns within the state', async () => {
    db.agent_payouts = [{ agent_id: 'lagos-1', state: 'Lagos', assigned_at: '2026-01-01T00:00:00Z' }];
    expect((await pickAgent({ state: 'Lagos' })).id).toBe('lagos-2');
  });

  it('ignores work the agent did in another state', async () => {
    db.agent_states.push({ agent_id: 'lagos-1', state: 'Ogun' });
    db.agent_payouts = [{ agent_id: 'lagos-1', state: 'Ogun', assigned_at: '2026-01-01T00:00:00Z' }];
    db.agent_states = db.agent_states.filter((row) => row.agent_id !== 'lagos-2');
    expect((await pickAgent({ state: 'Lagos' })).id).toBe('lagos-1');
  });

  it('returns null when nobody covers the state', async () => {
    expect(await pickAgent({ state: 'Kano' })).toBeNull();
  });
});

describe('runAgentPipeline', () => {
  it('assigns, records profit and holds the payout while payouts are off', async () => {
    db.guest_renewal_orders = [guestOrder()];
    db.agents = [agent('a1')];
    db.agent_states = [{ agent_id: 'a1', state: 'Lagos' }];
    db.agent_service_costs = [cost('road_worthiness', 'Lagos', 1200000)];

    await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } });

    expect(db.guest_renewal_orders[0]).toMatchObject({ assigned_agent_id: 'a1', agent_work_status: 'assigned' });
    expect(db.agent_payouts[0]).toMatchObject({
      status: 'manual_review',
      failure_reason: 'payouts_disabled',
      state: 'Lagos',
      amount_kobo: 1200000,
      customer_amount_kobo: 2000000,
      profit_kobo: 800000,
    });
    expect(db.agent_order_events[0]).toMatchObject({ event_type: 'assigned', agent_id: 'a1', guest_order_id: 'g1' });
  });

  it('leaves the order unassigned and alerts when nobody covers the state', async () => {
    db.guest_renewal_orders = [guestOrder()];
    db.agents = [agent('a1')];
    db.agent_states = [{ agent_id: 'a1', state: 'Ogun' }];

    const result = await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } });

    expect(result).toEqual({ skipped: 'no_active_agent' });
    expect(db.guest_renewal_orders[0].assigned_agent_id).toBeNull();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('leaves the order unassigned and alerts when it has no state', async () => {
    db.guest_renewal_orders = [guestOrder({ renewal_state: null })];

    expect(await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } })).toEqual({ skipped: 'no_state' });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a replayed webhook', async () => {
    db.guest_renewal_orders = [guestOrder({ assigned_agent_id: 'a1' })];

    expect(await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } })).toEqual({ skipped: 'already_assigned' });
    expect(db.agent_payouts).toBeUndefined();
  });
});

describe('assignOrderManually', () => {
  it('lets an admin assign an agent outside the state', async () => {
    db.guest_renewal_orders = [guestOrder()];
    db.agents = [agent('ogun-1')];
    db.agent_service_costs = [cost('road_worthiness', 'default', 500000)];

    const result = await assignOrderManually({ orderType: 'guest', orderId: 'g1', agentId: 'ogun-1', actor: 'a@b.c' });

    expect(result.agent.id).toBe('ogun-1');
    expect(db.agent_order_events[0]).toMatchObject({ event_type: 'assigned', actor: 'a@b.c' });
  });
});

describe('reassignOrder', () => {
  beforeEach(() => {
    db.guest_renewal_orders = [guestOrder({ assigned_agent_id: 'a1', agent_work_status: 'in_progress' })];
    db.agents = [agent('a1'), agent('a2'), agent('off', { status: 'inactive' })];
    db.agent_service_costs = [cost('road_worthiness', 'Lagos', 1200000)];
  });

  const held = (status) => ({
    id: 'p1', order_type: 'guest', guest_order_id: 'g1', agent_id: 'a1', status, amount_kobo: 1200000, missing_costs: [],
  });

  it('cancels the held payout and opens a new one for the new agent', async () => {
    db.agent_payouts = [held('manual_review')];

    const result = await reassignOrder({ orderType: 'guest', orderId: 'g1', agentId: 'a2', note: 'a1 is away' });

    expect(result.error).toBeUndefined();
    expect(db.guest_renewal_orders[0]).toMatchObject({ assigned_agent_id: 'a2', agent_work_status: 'assigned' });
    expect(db.agent_payouts.find((p) => p.id === 'p1').status).toBe('cancelled');
    expect(db.agent_payouts.find((p) => p.id !== 'p1')).toMatchObject({ agent_id: 'a2', status: 'manual_review' });
    expect(db.agent_order_events[0]).toMatchObject({ event_type: 'reassigned', agent_id: 'a2', note: 'a1 is away' });
  });

  it.each(['pending', 'processing', 'success'])('refuses once a payout is %s', async (status) => {
    db.agent_payouts = [held(status)];

    const result = await reassignOrder({ orderType: 'guest', orderId: 'g1', agentId: 'a2' });

    expect(result).toEqual({ error: 'payout_already_sent' });
    expect(db.guest_renewal_orders[0].assigned_agent_id).toBe('a1');
    expect(db.agent_payouts).toHaveLength(1);
  });

  it('refuses an inactive agent and the current agent', async () => {
    expect(await reassignOrder({ orderType: 'guest', orderId: 'g1', agentId: 'off' })).toEqual({ error: 'agent_inactive' });
    expect(await reassignOrder({ orderType: 'guest', orderId: 'g1', agentId: 'a1' })).toEqual({ error: 'same_agent' });
  });
});

describe('retryPayout', () => {
  it('recalculates after a missing cost is set, and cancels the old row', async () => {
    db.guest_renewal_orders = [guestOrder({ assigned_agent_id: 'a1' })];
    db.agents = [agent('a1')];
    db.agent_service_costs = [cost('road_worthiness', 'Lagos', 1200000)];
    db.agent_payouts = [{
      id: 'p1', order_type: 'guest', guest_order_id: 'g1', agent_id: 'a1', status: 'manual_review', amount_kobo: 0,
      provider: 'monipay', agents: agent('a1'),
      missing_costs: [{ service_type: 'renewal_item', service_key: 'road_worthiness' }],
    }];

    const { payout } = await retryPayout('p1');

    expect(payout).toMatchObject({ amount_kobo: 1200000, profit_kobo: 800000, missing_costs: [], status: 'manual_review' });
    expect(db.agent_payouts.find((p) => p.id === 'p1').status).toBe('cancelled');
  });
});

describe('markPaidManually', () => {
  it('refuses a row with missing costs, because its amount is incomplete', async () => {
    db.agent_payouts = [{ id: 'p1', status: 'manual_review', missing_costs: [{ service_key: 'x' }] }];

    const result = await markPaidManually('p1');

    expect(result.error).toMatch(/missing costs/);
    expect(db.agent_payouts[0].status).toBe('manual_review');
  });

  it('refuses a cancelled row', async () => {
    db.agent_payouts = [{ id: 'p1', status: 'cancelled', missing_costs: [] }];

    expect((await markPaidManually('p1')).error).toBe('not_found_or_final');
    expect(db.agent_payouts[0].status).toBe('cancelled');
  });

  it('records a held payout as paid', async () => {
    db.agent_payouts = [{ id: 'p1', status: 'manual_review', missing_costs: [] }];

    const { payout } = await markPaidManually('p1', 'bank app');

    expect(payout).toMatchObject({ status: 'success', provider: 'manual' });
  });
});

describe('work progress', () => {
  it('only allows the agreed moves', () => {
    expect(canTransition('assigned', 'in_progress')).toBe(true);
    expect(canTransition('submitted', 'completed')).toBe(true);
    expect(canTransition('assigned', 'completed')).toBe(false);
    expect(canTransition('completed', 'in_progress')).toBe(false);
  });

  it('updates the order and records who did it', async () => {
    db.renewal_orders = [{ id: 7, assigned_agent_id: 'a1', agent_work_status: 'assigned' }];

    const result = await setAgentWorkStatus({ orderType: 'regular', orderId: 7, status: 'in_progress', note: 'at VIO', actor: 'a@b.c' });

    expect(result).toEqual({ status: 'in_progress' });
    expect(db.renewal_orders[0].agent_work_status).toBe('in_progress');
    expect(db.agent_order_events[0]).toMatchObject({ regular_order_id: 7, event_type: 'in_progress', note: 'at VIO', actor: 'a@b.c' });
  });

  it('refuses an order with no agent and a move that is not allowed', async () => {
    db.renewal_orders = [{ id: 7, assigned_agent_id: null }, { id: 8, assigned_agent_id: 'a1', agent_work_status: 'completed' }];

    expect(await setAgentWorkStatus({ orderType: 'regular', orderId: 7, status: 'in_progress' })).toEqual({ error: 'no_agent_assigned' });
    expect(await setAgentWorkStatus({ orderType: 'regular', orderId: 8, status: 'in_progress' })).toEqual({ error: 'cannot_move_completed_to_in_progress' });
    expect(db.agent_order_events).toBeUndefined();
  });
});

describe('summarisePayouts', () => {
  const rows = [
    { agent_id: 'a1', agents: { name: 'Ada' }, state: 'Lagos', status: 'success', amount_kobo: 100, customer_amount_kobo: 150, profit_kobo: 50 },
    { agent_id: 'a1', agents: { name: 'Ada' }, state: 'Lagos', status: 'manual_review', amount_kobo: 200, customer_amount_kobo: 260, profit_kobo: 60 },
    { agent_id: 'a2', agents: { name: 'Bo' }, state: 'Ogun', status: 'manual_review', amount_kobo: 10, customer_amount_kobo: 90, profit_kobo: null },
    { agent_id: 'a1', agents: { name: 'Ada' }, state: 'Lagos', status: 'cancelled', amount_kobo: 999, customer_amount_kobo: 999, profit_kobo: 999 },
  ];

  it('totals money overall, by agent and by state, leaving out cancelled rows', () => {
    const { overall, by_agent: byAgent, by_state: byState } = summarisePayouts(rows);

    expect(overall).toMatchObject({ orders: 3, cost_kobo: 310, profit_kobo: 110, paid_kobo: 100, owed_kobo: 210, unpriced_orders: 1 });
    expect(byAgent.find((a) => a.agent_id === 'a1')).toMatchObject({ agent_name: 'Ada', orders: 2, profit_kobo: 110 });
    expect(byState.find((s) => s.state === 'Ogun')).toMatchObject({ orders: 1, unpriced_orders: 1 });
  });
});

describe('agent NIN documents', () => {
  const body = { name: 'Ada Obi', phone: '0801', account_number: '0123456789', bank_code: '058', states: '["Lagos","Ogun"]' };
  const files = () => ({ nin_front: ninFile(), nin_back: ninFile('application/pdf') });

  it('creates an agent with both sides in the private bucket and its states', async () => {
    const res = fakeRes();
    await createAgent({ body, files: files() }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockStorage.uploads.map((u) => u.bucket)).toEqual(['agent-documents', 'agent-documents']);
    expect(db.agents[0].nin_front_path).toMatch(new RegExp(`^${db.agents[0].id}/nin-front-.*\\.jpg$`));
    expect(db.agents[0].nin_back_path).toMatch(/\.pdf$/);
    expect(db.agent_states.map((row) => row.state)).toEqual(['Lagos', 'Ogun']);
  });

  it.each([
    ['no files', undefined],
    ['only the back', { nin_back: ninFile() }],
  ])('refuses to create an agent with %s', async (_label, requestFiles) => {
    const res = fakeRes();
    await createAgent({ body, files: requestFiles }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.agents).toBeUndefined();
    expect(mockStorage.uploads).toEqual([]);
  });

  it('creates an agent with only the front of the NIN', async () => {
    const res = fakeRes();
    await createAgent({ body, files: { nin_front: ninFile() } }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(db.agents[0].nin_front_path).toBeTruthy();
    expect(db.agents[0].nin_back_path).toBeUndefined();
  });

  it('saves no agent when an upload fails', async () => {
    mockUploadError = 'storage down';
    const res = fakeRes();
    await createAgent({ body, files: files() }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(db.agents).toBeUndefined();
  });

  it('refuses an account number that is not 10 digits', async () => {
    const res = fakeRes();
    await createAgent({ body: { ...body, account_number: '123' }, files: files() }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockStorage.uploads).toEqual([]);
  });

  it('replaces one side on edit, removes the old image and keeps the other side', async () => {
    db.agents = [{ id: 'a1', name: 'Ada', nin_front_path: 'a1/old-front.jpg', nin_back_path: 'a1/old-back.jpg' }];
    const res = fakeRes();
    await updateAgent({ params: { id: 'a1' }, body: { name: 'Ada Obi' }, files: { nin_front: ninFile() } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.agents[0].nin_front_path).toMatch(/^a1\/nin-front-/);
    expect(db.agents[0].nin_back_path).toBe('a1/old-back.jpg');
    expect(mockStorage.removed).toEqual(['a1/old-front.jpg']);
  });

  it('still updates from a plain JSON request with no files', async () => {
    db.agents = [{ id: 'a1', status: 'active', nin_front_path: 'a1/f.jpg' }];
    const res = fakeRes();
    await updateAgent({ params: { id: 'a1' }, body: { status: 'inactive' } }, res);

    expect(db.agents[0]).toMatchObject({ status: 'inactive', nin_front_path: 'a1/f.jpg' });
    expect(mockStorage.removed).toEqual([]);
  });

  it('only opens a NIN through a short-lived signed URL', async () => {
    db.agents = [{ id: 'a1', nin_front_path: 'a1/f.jpg', nin_back_path: null }];

    const ok = fakeRes();
    await getAgentNinUrl({ params: { id: 'a1', side: 'front' } }, ok);
    expect(ok.json.mock.calls[0][0].data.url).toBe('https://signed.example/agent-documents/a1/f.jpg?expires=300');

    const missing = fakeRes();
    await getAgentNinUrl({ params: { id: 'a1', side: 'back' } }, missing);
    expect(missing.status).toHaveBeenCalledWith(404);

    const badSide = fakeRes();
    await getAgentNinUrl({ params: { id: 'a1', side: 'selfie' } }, badSide);
    expect(badSide.status).toHaveBeenCalledWith(400);
  });
});

describe('resolveBankAccount', () => {
  const realFetch = global.fetch;
  const paystackReplies = (status, body) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  };
  const resolve = async (query = { account_number: '0123456789', bank_code: '058' }) => {
    const res = fakeRes();
    res.json.mockImplementation(() => res);
    await resolveBankAccount({ query }, res);
    return res;
  };

  afterEach(() => { global.fetch = realFetch; });

  it('returns only the account name', async () => {
    paystackReplies(200, { status: true, data: { account_name: 'ADA OBI', account_number: '0123456789', bank_id: 9 } });

    const res = await resolve();

    expect(global.fetch.mock.calls[0][0]).toContain('account_number=0123456789&bank_code=058');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { account_name: 'ADA OBI' } });
  });

  it('reports an account that does not exist', async () => {
    paystackReplies(422, { status: false, message: 'Could not resolve account name' });

    expect((await resolve()).status).toHaveBeenCalledWith(422);
  });

  it.each([[401], [429], [500]])('reports the check as unavailable on Paystack %i', async (status) => {
    paystackReplies(status, { status: false, message: 'no' });

    expect((await resolve()).status).toHaveBeenCalledWith(503);
  });

  it('reports the check as unavailable when Paystack cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    expect((await resolve()).status).toHaveBeenCalledWith(503);
  });

  it.each([
    [{ account_number: '123', bank_code: '058' }],
    [{ account_number: '0123456789' }],
    [{ account_number: '0123456789', bank_code: '058&x=1' }],
  ])('refuses bad input without calling Paystack: %j', async (query) => {
    global.fetch = jest.fn();

    const res = await resolve(query);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('getAgentOrders', () => {
  beforeEach(() => {
    db.agents = [{ id: 'a1', name: 'Ada', agent_states: [{ state: 'Lagos' }] }, { id: 'a2', name: 'Bo' }];
    db.renewal_items = [{ item_key: 'road_worthiness', name: 'Road Worthiness' }];
    db.profiles = [{ id: 'u1', first_name: 'Tola', last_name: 'Ade' }];
    db.renewal_orders = [
      { id: 7, order_number: 'MTK-7', user_id: 'u1', assigned_agent_id: 'a1', agent_work_status: 'in_progress', metadata: { selected_items: ['road_worthiness'] }, cars: { registration_no: 'ABC123', vehicle_make: 'Toyota', vehicle_model: 'Corolla' }, created_at: '2026-01-01T00:00:00Z' },
      { id: 8, order_number: 'MTK-8', user_id: 'u1', assigned_agent_id: 'a1', agent_work_status: 'completed', metadata: { plate_type: 'Normal' }, created_at: '2026-01-02T00:00:00Z' },
      { id: 9, order_number: 'MTK-9', user_id: 'u1', assigned_agent_id: 'a2', agent_work_status: 'assigned', metadata: {}, created_at: '2026-01-03T00:00:00Z' },
    ];
    db.guest_renewal_orders = [
      { id: 'g1', guest_name: 'Sola', plate_number: 'XYZ9', assigned_agent_id: 'a1', agent_work_status: null, selected_items: ['road_worthiness'], renewal_state: 'Lagos', created_at: '2026-01-04T00:00:00Z' },
    ];
    db.agent_payouts = [
      { order_type: 'regular', regular_order_id: 7, agent_id: 'a1', status: 'manual_review', amount_kobo: 1000, profit_kobo: 500, state: 'Lagos', assigned_at: '2026-01-01T00:00:00Z' },
      { order_type: 'regular', regular_order_id: 8, agent_id: 'a1', status: 'success', amount_kobo: 2000, profit_kobo: 100, state: 'Lagos', assigned_at: '2026-01-02T00:00:00Z', paid_at: '2026-01-03T00:00:00Z' },
      { order_type: 'regular', regular_order_id: 8, agent_id: 'a1', status: 'cancelled', amount_kobo: 9999, state: 'Lagos', assigned_at: '2026-01-02T00:00:00Z' },
    ];
    db.agent_order_events = [
      { order_type: 'regular', regular_order_id: 8, agent_id: 'a1', event_type: 'completed', created_at: '2026-01-05T00:00:00Z' },
    ];
  });

  const load = async (id = 'a1') => {
    const res = fakeRes();
    await getAgentOrders({ params: { id } }, res);
    return res;
  };

  it('lists only this agent\'s orders, regular and guest, with their documents and status', async () => {
    const { orders, agent } = (await load()).json.mock.calls[0][0].data;
    const by = (ref) => orders.find((o) => o.order_slug === ref);

    expect(agent.states).toEqual(['Lagos']);
    expect(orders.map((o) => o.order_slug).sort()).toEqual(['MTK-7', 'MTK-8', 'g1']);
    expect(by('MTK-7')).toMatchObject({
      customer_name: 'Tola Ade', plate: 'ABC123', vehicle: 'Toyota Corolla', documents: ['Road Worthiness'], work_status: 'in_progress', agent_cost_kobo: 1000, profit_kobo: 500,
    });
    expect(by('MTK-8')).toMatchObject({ documents: ['Plate number (Normal)'], work_status: 'completed', completed_at: '2026-01-05T00:00:00Z', payout_status: 'success', agent_cost_kobo: 2000 });
    expect(by('g1')).toMatchObject({ customer_name: 'Sola', plate: 'XYZ9', work_status: 'assigned', state: 'Lagos', agent_cost_kobo: null });
  });

  it('counts the work and ignores cancelled payouts', async () => {
    const { summary, truncated } = (await load()).json.mock.calls[0][0].data;

    expect(summary).toEqual({ total: 3, working: 2, completed: 1, rejected: 0, paid_kobo: 2000, owed_kobo: 1000 });
    expect(truncated).toBe(false);
  });

  it('returns 404 for an unknown agent', async () => {
    expect((await load('nope')).status).toHaveBeenCalledWith(404);
  });

  it('counts a rejected order on its own', () => {
    expect(summariseAgentOrders([{ work_status: 'rejected', agent_cost_kobo: null }])).toMatchObject({ rejected: 1, working: 0, owed_kobo: 0 });
  });
});

describe('orders on hold', () => {
  const heldGuest = () => guestOrder({ scheduled_for: '2027-01-01' });

  it('recognises a hold on both order types', () => {
    expect(isOrderOnHold({ orderType: 'regular', order: { status: 'scheduled' } })).toBe(true);
    expect(isOrderOnHold({ orderType: 'regular', order: { status: 'processing' } })).toBe(false);
    expect(isOrderOnHold({ orderType: 'guest', order: { scheduled_for: '2027-01-01' } })).toBe(true);
    expect(isOrderOnHold({ orderType: 'guest', order: { scheduled_for: null } })).toBe(false);
  });

  it('assigns no agent and opens no payout at payment, without alerting anyone', async () => {
    db.renewal_orders = [{ id: 7, status: 'scheduled', renewal_state: 'Lagos', assigned_agent_id: null, metadata: {} }];
    db.guest_renewal_orders = [heldGuest()];
    db.agents = [agent('a1')];
    db.agent_states = [{ agent_id: 'a1', state: 'Lagos' }];

    expect(await runAgentPipeline({ orderType: 'regular', order: { id: 7 } })).toEqual({ skipped: 'on_hold' });
    expect(await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } })).toEqual({ skipped: 'on_hold' });

    expect(db.renewal_orders[0].assigned_agent_id).toBeNull();
    expect(db.guest_renewal_orders[0].assigned_agent_id).toBeNull();
    expect(db.agent_payouts).toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('assigns the agent once the hold is gone', async () => {
    db.guest_renewal_orders = [guestOrder({ scheduled_for: null })];
    db.agents = [agent('a1')];
    db.agent_states = [{ agent_id: 'a1', state: 'Lagos' }];
    db.agent_service_costs = [cost('road_worthiness', 'Lagos', 1200000)];

    await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } });

    expect(db.guest_renewal_orders[0].assigned_agent_id).toBe('a1');
    expect(db.agent_payouts).toHaveLength(1);
  });

  it('refuses to assign, reassign or retry by hand while on hold', async () => {
    db.guest_renewal_orders = [heldGuest()];
    db.agents = [agent('a1'), agent('a2')];

    expect(await assignOrderManually({ orderType: 'guest', orderId: 'g1', agentId: 'a1' })).toEqual({ error: 'order_on_hold' });

    db.guest_renewal_orders[0].assigned_agent_id = 'a1';
    expect(await reassignOrder({ orderType: 'guest', orderId: 'g1', agentId: 'a2' })).toEqual({ error: 'order_on_hold' });

    db.agent_payouts = [{ id: 'p1', order_type: 'guest', guest_order_id: 'g1', agent_id: 'a1', status: 'manual_review', agents: agent('a1') }];
    expect(await retryPayout('p1')).toEqual({ error: 'order_on_hold' });
    expect(db.agent_payouts[0].status).toBe('manual_review');
  });
});

describe('completeAgentWork', () => {
  it('finishes the agent\'s work and records it', async () => {
    db.renewal_orders = [{ id: 7, assigned_agent_id: 'a1', agent_work_status: 'in_progress' }];

    await completeAgentWork({ orderType: 'regular', orderId: 7, actor: 'a@b.c' });

    expect(db.renewal_orders[0].agent_work_status).toBe('completed');
    expect(db.agent_order_events[0]).toMatchObject({ regular_order_id: 7, agent_id: 'a1', event_type: 'completed', actor: 'a@b.c' });
  });

  it.each([
    ['has no agent', { assigned_agent_id: null, agent_work_status: null }],
    ['is already completed', { assigned_agent_id: 'a1', agent_work_status: 'completed' }],
    ['was rejected', { assigned_agent_id: 'a1', agent_work_status: 'rejected' }],
  ])('leaves an order alone that %s', async (_label, fields) => {
    db.renewal_orders = [{ id: 7, ...fields }];

    await completeAgentWork({ orderType: 'regular', orderId: 7 });

    expect(db.renewal_orders[0].agent_work_status).toBe(fields.agent_work_status);
    expect(db.agent_order_events).toBeUndefined();
  });
});

describe('admin order status changes', () => {
  beforeEach(() => {
    db.agents = [agent('a1')];
    db.agent_states = [{ agent_id: 'a1', state: 'Lagos' }];
    db.agent_service_costs = [cost('road_worthiness', 'Lagos', 1200000)];
  });

  const regularOrder = (extra) => ({
    id: 7, order_number: 'MTK-7', renewal_state: 'Lagos', assigned_agent_id: null,
    metadata: { selected_items: ['road_worthiness'] }, renewal_amount: 2000000, amount_paid: 2000000, delivery_fee: 0, ...extra,
  });

  it('assigns an agent when an admin releases a held order', async () => {
    db.renewal_orders = [regularOrder({ status: 'scheduled', scheduled_for: '2027-01-01' })];

    await updateOrderStatus({ params: { orderNumber: 'MTK-7' }, body: { status: 'in_progress' }, admin: { id: 'x' } }, fakeRes());

    expect(db.renewal_orders[0]).toMatchObject({ status: 'processing', assigned_agent_id: 'a1' });
    expect(db.agent_payouts).toHaveLength(1);
  });

  it('assigns nothing when an admin puts an order on hold', async () => {
    db.renewal_orders = [regularOrder({ status: 'pending' })];

    await updateOrderStatus({ params: { orderNumber: 'MTK-7' }, body: { status: 'scheduled', scheduled_for: '2027-01-01' }, admin: { id: 'x' } }, fakeRes());

    expect(db.renewal_orders[0]).toMatchObject({ status: 'scheduled', assigned_agent_id: null });
    expect(db.agent_payouts).toBeUndefined();
  });

  it('completes the agent\'s work when a guest order is completed', async () => {
    db.guest_renewal_orders = [guestOrder({ assigned_agent_id: 'a1', agent_work_status: 'submitted', payment_status: 'payment_success', fulfillment_status: 'processing' })];

    await updateGuestOrderStatus({ params: { id: 'g1' }, body: { status: 'completed' }, admin: { email: 'a@b.c' } }, fakeRes());

    expect(db.guest_renewal_orders[0]).toMatchObject({ fulfillment_status: 'completed', agent_work_status: 'completed' });
    expect(db.agent_order_events[0]).toMatchObject({ event_type: 'completed', actor: 'a@b.c' });
  });

  it('leaves the agent\'s work alone when a guest order is only moved to processing', async () => {
    db.guest_renewal_orders = [guestOrder({ assigned_agent_id: 'a1', agent_work_status: 'assigned', payment_status: 'payment_success', fulfillment_status: 'pending' })];

    await updateGuestOrderStatus({ params: { id: 'g1' }, body: { status: 'processing' }, admin: { id: 'x' } }, fakeRes());

    expect(db.guest_renewal_orders[0].agent_work_status).toBe('assigned');
    expect(db.agent_order_events).toBeUndefined();
  });
});

describe('cancelled orders', () => {
  const held = (status, id = 'p1') => ({
    id, order_type: 'guest', guest_order_id: 'g1', agent_id: 'a1', status, amount_kobo: 1200000, missing_costs: [], agents: agent('a1'),
  });

  beforeEach(() => {
    db.agents = [agent('a1'), agent('a2')];
    db.agent_states = [{ agent_id: 'a1', state: 'Lagos' }];
    db.agent_service_costs = [cost('road_worthiness', 'Lagos', 1200000)];
    db.guest_renewal_orders = [guestOrder({ assigned_agent_id: 'a1', agent_work_status: 'in_progress', fulfillment_status: 'cancelled', payment_status: 'payment_success' })];
  });

  it.each(['manual_review', 'failed'])('cancels a %s payout and takes the order off the agent', async (status) => {
    db.agent_payouts = [held(status)];

    expect(await releaseAgentFromCancelledOrder({ orderType: 'guest', orderId: 'g1', actor: 'a@b.c' })).toEqual({ released: true });

    expect(db.agent_payouts[0].status).toBe('cancelled');
    expect(db.guest_renewal_orders[0]).toMatchObject({ assigned_agent_id: null, agent_work_status: null });
    expect(db.agent_order_events[0]).toMatchObject({ event_type: 'cancelled', agent_id: 'a1', actor: 'a@b.c' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it.each(['pending', 'processing', 'success'])('keeps a %s payout and alerts the admin', async (status) => {
    db.agent_payouts = [held(status)];

    expect(await releaseAgentFromCancelledOrder({ orderType: 'guest', orderId: 'g1' })).toEqual({ skipped: 'payment_sent' });

    expect(db.agent_payouts[0].status).toBe(status);
    expect(db.guest_renewal_orders[0].assigned_agent_id).toBe('a1');
    expect(db.agent_order_events[0].event_type).toBe('cancelled');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].subject).toMatch(/Cancelled order/);
  });

  it('does nothing for an order with no agent', async () => {
    db.guest_renewal_orders[0].assigned_agent_id = null;

    expect(await releaseAgentFromCancelledOrder({ orderType: 'guest', orderId: 'g1' })).toEqual({ skipped: 'no_agent' });
    expect(db.agent_order_events).toBeUndefined();
  });

  it('refuses agent actions on a cancelled order', async () => {
    db.agent_payouts = [held('manual_review')];

    expect(await reassignOrder({ orderType: 'guest', orderId: 'g1', agentId: 'a2' })).toEqual({ error: 'order_cancelled' });
    expect(await setAgentWorkStatus({ orderType: 'guest', orderId: 'g1', status: 'submitted' })).toEqual({ error: 'order_cancelled' });
    expect(await retryPayout('p1')).toEqual({ error: 'order_cancelled' });

    db.guest_renewal_orders[0].assigned_agent_id = null;
    expect(await assignOrderManually({ orderType: 'guest', orderId: 'g1', agentId: 'a2' })).toEqual({ error: 'order_cancelled' });
    expect(await runAgentPipeline({ orderType: 'guest', order: { id: 'g1' } })).toEqual({ skipped: 'cancelled' });
  });

  it('runs when an admin cancels a guest order, and reopening assigns an agent again', async () => {
    db.guest_renewal_orders[0].fulfillment_status = 'processing';
    db.agent_payouts = [held('manual_review')];

    await updateGuestOrderStatus({ params: { id: 'g1' }, body: { status: 'cancelled' }, admin: { id: 'x' } }, fakeRes());

    expect(db.guest_renewal_orders[0]).toMatchObject({ fulfillment_status: 'cancelled', assigned_agent_id: null });
    expect(db.agent_payouts[0].status).toBe('cancelled');

    await reopenGuestOrder({ params: { id: 'g1' }, body: {}, admin: { id: 'x' } }, fakeRes());

    expect(db.guest_renewal_orders[0]).toMatchObject({ fulfillment_status: 'pending', assigned_agent_id: 'a1', agent_work_status: 'assigned' });
    expect(db.agent_payouts.filter((p) => p.status === 'manual_review')).toHaveLength(1);
  });

  it('runs when an admin cancels a signed-in order, and reopening assigns an agent again', async () => {
    db.renewal_orders = [{
      id: 7, order_number: 'MTK-7', status: 'processing', renewal_state: 'Lagos', assigned_agent_id: 'a1', agent_work_status: 'assigned',
      metadata: { selected_items: ['road_worthiness'] }, renewal_amount: 2000000, amount_paid: 2000000, delivery_fee: 0,
    }];
    db.agent_payouts = [{ id: 'p7', order_type: 'regular', regular_order_id: 7, agent_id: 'a1', status: 'manual_review', amount_kobo: 1200000, missing_costs: [] }];

    await updateOrderStatus({ params: { orderNumber: 'MTK-7' }, body: { status: 'declined' }, admin: { id: 'x' } }, fakeRes());

    expect(db.renewal_orders[0]).toMatchObject({ status: 'cancelled', assigned_agent_id: null });
    expect(db.agent_payouts[0].status).toBe('cancelled');

    await reopenOrder({ params: { orderNumber: 'MTK-7' }, body: {}, admin: { id: 'x' } }, fakeRes());

    expect(db.renewal_orders[0]).toMatchObject({ status: 'pending', assigned_agent_id: 'a1' });
  });

  it('shows a paid cancelled order on the agent page without counting it as work', async () => {
    db.renewal_items = [];
    db.renewal_orders = [];
    db.guest_renewal_orders[0].guest_name = 'Sola';
    db.agent_payouts = [{ ...held('success'), state: 'Lagos' }];

    const res = fakeRes();
    await getAgentOrders({ params: { id: 'a1' } }, res);
    const { orders, summary } = res.json.mock.calls[0][0].data;

    expect(orders[0].work_status).toBe('cancelled');
    expect(summary).toMatchObject({ working: 0, completed: 0, paid_kobo: 1200000 });
  });
});
