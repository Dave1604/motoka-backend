import { jest } from '@jest/globals';

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q, limit: () => q,
        then: (res) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return q;
    },
  }),
}));

const { getProfile } = await import('../controllers/profile.controller.js');

const runGetProfile = async (profile) => {
  let payload;
  const res = {
    status: () => res,
    json: (body) => { payload = body; return res; },
  };
  await getProfile({ user: { id: 'u1', email: 'a@b.com', profile } }, res);
  return payload?.data?.profile;
};

test('a verified plate reaches the user with its car details', async () => {
  const p = await runGetProfile({
    user_id: 'u1', plate_number: 'AKD455GQ',
    plate_verification_status: 'verified', plate_verified_at: '2026-11-06T10:00:00Z',
    plate_bonus_credited: true,
    car_brand: 'Toyota', car_model: 'Corolla', car_color: 'Silver', car_year: 2015,
  });
  expect(p.plate_number).toBe('AKD455GQ');
  expect(p.plate_verification_status).toBe('verified');
  expect(p.plate_bonus_credited).toBe(true);
  expect(p).toMatchObject({ car_brand: 'Toyota', car_model: 'Corolla', car_color: 'Silver', car_year: 2015 });
});

test('an unverified plate reports pending with nulls, not undefined', async () => {
  const p = await runGetProfile({ user_id: 'u1', plate_number: 'AKD455GQ', plate_verification_status: 'pending' });
  expect(p.plate_verification_status).toBe('pending');
  expect(p.car_brand).toBeNull();
  expect(p.plate_bonus_credited).toBe(false);
});
