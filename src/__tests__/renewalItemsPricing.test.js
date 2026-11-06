import { jest } from '@jest/globals';

const ROWS = [
  { item_key: 'road_worthiness', name: 'Road Worthiness', price: 1200000, price_lagos: 1500000, required: true, active: true },
  { item_key: 'insurance',       name: 'Insurance',       price: 1500000, price_lagos: null,     required: false, active: true },
];

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q, order: () => q, eq: () => q,
        then: (res) => Promise.resolve({ data: ROWS, error: null }).then(res),
      };
      return q;
    },
  }),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({ logError: () => {}, logInfo: () => {}, logDebug: () => {} }));

const { getRenewalItems, validateRenewalItemsSelection } = await import('../services/payment/renewalItems.service.js');

const rw = (items) => items.find((i) => i.id === 'road_worthiness').price;

test('Lagos and non-Lagos prices do not contaminate each other through the cache', async () => {
  // Back to back, well inside the 60s TTL — this is what used to break.
  expect(rw(await getRenewalItems({ state: 'Lagos' }))).toBe(1500000);
  expect(rw(await getRenewalItems({ state: 'Ogun'  }))).toBe(1200000);
  expect(rw(await getRenewalItems({ state: 'Lagos' }))).toBe(1500000);
  expect(rw(await getRenewalItems({ state: null    }))).toBe(1200000);
});

test('guest total is priced with the state it was given', async () => {
  const lagos = await validateRenewalItemsSelection(['road_worthiness'], 'Lagos');
  const ogun  = await validateRenewalItemsSelection(['road_worthiness'], 'Ogun');
  expect(lagos.total).toBe(1500000);
  expect(ogun.total).toBe(1200000);
});
