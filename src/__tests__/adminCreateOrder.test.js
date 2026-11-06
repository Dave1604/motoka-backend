import { jest } from '@jest/globals';

// profiles.id is the auth uid (what cars.user_id references); profiles.user_id is the short display id
const rows = { profiles: { id: 'u1', user_id: 'MTK-0001', first_name: 'A', last_name: 'B', email: 'a@b.com' },
               cars: { id: 7, user_id: 'u1', registration_no: 'AKD455GQ', expiry_date: '2027-01-01' },
               renewal_orders: { id: 99, order_number: 'ORD-20261106-00001', transaction_id: 55, status: 'pending' },
               plate_number_prices: { price: 25000 },
               driver_license_prices: { price: 15000 } };
const mkQuery = (table) => { const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: rows[table] ?? null }) }; return q; };
jest.unstable_mockModule('../../config/supabase.js'.replace('../../', '../'), () => ({ getSupabaseAdmin: () => ({ from: (t) => mkQuery(t) }) }));
jest.unstable_mockModule('../utils/logger.js', () => ({ logError: () => {}, logInfo: () => {}, logDebug: () => {} }));
const validate = jest.fn(async (items, state) => ({ valid: true, total: state === 'Lagos' ? 1500000 : 1200000 }));
jest.unstable_mockModule('../services/payment/renewalItems.service.js', () => ({ validateRenewalItemsSelection: validate }));
const createTransaction = jest.fn(async (args) => ({ id: 55, reference: 'MAN-TEST', ...args }));
const processPaymentSuccess = jest.fn(async () => ({ transaction_id: 55, order_id: 99, already_processed: false }));
jest.unstable_mockModule('../services/payment/transaction.service.js', () => ({ createTransaction, processPaymentSuccess }));

const { adminCreateOrder } = await import('../controllers/admin/orders.controller.js');
const call = async (body) => { let out; const res = { status: (c) => ({ json: (b) => { out = { code: c, body: b }; } }) }; await adminCreateOrder({ body, user: { id: 'admin1' } }, res); return out; };

beforeEach(() => { createTransaction.mockClear(); processPaymentSuccess.mockClear(); validate.mockClear(); });

test('rejects a body with no user or car', async () => {
  expect((await call({})).code).toBe(400);
  expect(createTransaction).not.toHaveBeenCalled();
});

test('rejects an unknown channel', async () => {
  const r = await call({ user_id: 'u1', car_id: 7, selected_items: ['road_worthiness'], channel: 'crypto' });
  expect(r.code).toBe(400);
});

test('rejects a car that belongs to someone else', async () => {
  rows.cars.user_id = 'someone-else';
  const r = await call({ user_id: 'u1', car_id: 7, selected_items: ['road_worthiness'] });
  rows.cars.user_id = 'u1';
  expect(r.code).toBe(400);
  expect(createTransaction).not.toHaveBeenCalled();
});

test('records a successful manual transaction priced for the state and raises the order through the RPC', async () => {
  const r = await call({ user_id: 'u1', car_id: 7, selected_items: ['road_worthiness'], renewal_state: 'Lagos', channel: 'cash', offsite_reference: 'TRF-1', note: 'paid at office' });
  expect(r.code).toBe(201);
  expect(validate).toHaveBeenCalledWith(['road_worthiness'], 'Lagos');
  expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', carId: 7, amount: 1500000, paymentGateway: 'manual', paymentType: 'renewal_manual' }));
  expect(processPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({ reference: 'MAN-TEST', status: 'successful', channel: 'cash', orderType: 'renewal_manual', renewalAmount: 1500000, renewalState: 'Lagos' }));
  expect(r.body.data.order.order_number).toBe('ORD-20261106-00001');
  expect(r.body.data.transaction.amount).toBe(1500000);
});

test('a plate number order prices from plate_number_prices in kobo, keeps the car, and is typed plate_number', async () => {
  const r = await call({ user_id: 'u1', kind: 'plate_number', car_id: 7, plate_type: 'Normal', channel: 'pos' });
  expect(r.code).toBe(201);
  expect(validate).not.toHaveBeenCalled();
  expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ carId: 7, amount: 2500000, paymentType: 'plate_number', paymentGateway: 'manual' }));
  const meta = createTransaction.mock.calls[0][0].metadata;
  expect(meta).toMatchObject({ payment_type: 'plate_number', plate_type: 'Normal', sub_type: null });
  expect(processPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({ orderType: 'plate_number', selectedItems: [], renewalAmount: 2500000 }));
});

test('a driver licence order needs no car, validates type and duration, and is typed driver_license', async () => {
  const bad = await call({ user_id: 'u1', kind: 'driver_license', license_type: 'new', duration: '10yr' });
  expect(bad.code).toBe(400);
  const r = await call({ user_id: 'u1', kind: 'driver_license', license_type: 'New', duration: '5yr', channel: 'cash' });
  expect(r.code).toBe(201);
  expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ carId: null, amount: 1500000, paymentType: 'driver_license' }));
  const meta = createTransaction.mock.calls[0][0].metadata;
  expect(meta).toMatchObject({ payment_type: 'driver_license', license_type: 'new', duration: '5yr' });
  expect(processPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({ orderType: 'driver_license', renewalState: null }));
});

test('a plate order without a car is refused', async () => {
  const r = await call({ user_id: 'u1', kind: 'plate_number', plate_type: 'Normal' });
  expect(r.code).toBe(400);
});
