import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: jest.fn(),
  getSupabase: jest.fn(),
}));

// Heavy gateway/courier modules are never touched on these paths — stub them
// so importing the service under test has no side effects.
jest.unstable_mockModule('../services/payment/renewalItems.service.js', () => ({
  getRenewalItems: jest.fn(async () => []),
  validateRenewalItemsSelection: jest.fn(),
}));
jest.unstable_mockModule('../services/courier/deliveryQuote.service.js', () => ({
  quoteFromDeliveryFields: jest.fn(),
  DeliveryQuoteError: class DeliveryQuoteError extends Error {},
}));
jest.unstable_mockModule('../services/courier/terminal.service.js', () => ({
  TerminalError: class TerminalError extends Error {},
}));
jest.unstable_mockModule('../services/payment/monicredit/monicredit.service.js', () => ({
  verifyTransaction: jest.fn(),
}));
jest.unstable_mockModule('../services/payment/paystack.service.js', () => ({
  initializeTransaction: jest.fn(),
  verifyTransaction: jest.fn(),
}));
jest.unstable_mockModule('../services/payment/monipay/monipay.service.js', () => ({
  initializeTransaction: jest.fn(),
  verifyTransaction: jest.fn(),
}));
jest.unstable_mockModule('../services/email/paymentEmail.service.js', () => ({
  sendGuestPaymentConfirmationEmail: jest.fn(),
}));
jest.unstable_mockModule('../services/email/adminOrderAlert.service.js', () => ({
  sendAdminGuestOrderAlert: jest.fn(),
}));

const order = (over = {}) => ({
  id: 'order-1',
  guest_email: 'Guest@Example.com',
  guest_name: 'Ada Obi',
  guest_phone: '08030000000',
  plate_number: 'ABC123XY',
  ...over,
});

// Fluent query fake: from() -> chain; terminal methods resolve programmed values.
function fakeSupabase({ maybeSingleValues = [], insertError = null, insertErrors = [] } = {}) {
  const state = { maybeCalls: 0, inserts: 0, updates: [], createdUsers: [], updatedPasswords: [], deletedUsers: [] };
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(async () => ({ data: maybeSingleValues[state.maybeCalls++] ?? null, error: null })),
    insert: jest.fn(async () => {
      const err = state.inserts < insertErrors.length ? insertErrors[state.inserts] : insertError;
      state.inserts++;
      return { error: err };
    }),
    update: jest.fn((row) => {
      state.updates.push(row);
      return chain;
    }),
  };
  return {
    state,
    client: {
      from: jest.fn(() => chain),
      auth: {
        admin: {
          createUser: jest.fn(async (args) => {
            state.createdUsers.push(args);
            return { data: { user: { id: 'auth-user-1' } }, error: null };
          }),
          getUserById: jest.fn(async () => ({ data: { user: null }, error: null })),
          updateUserById: jest.fn(async (id, attrs) => {
            state.updatedPasswords.push({ id, attrs });
            return { data: { user: { id } }, error: null };
          }),
          deleteUser: jest.fn(async (id) => {
            state.deletedUsers.push(id);
            return { error: null };
          }),
        },
        signUp: jest.fn(),
        signInWithPassword: jest.fn(async () => ({ data: { session: { access_token: 'sess' } }, error: null })),
      },
    },
  };
}

describe('autoCreateGuestAccount', () => {
  let autoCreateGuestAccount;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ autoCreateGuestAccount } = await import('../services/guest/guestRenewal.service.js'));
  });

  it('creates a passwordless user, profile and order link', async () => {
    const fake = fakeSupabase();
    const userId = await autoCreateGuestAccount(fake.client, order());

    expect(userId).toBe('auth-user-1');
    expect(fake.client.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'guest@example.com',
        email_confirm: true,
      })
    );
    // No password key on the create call — claim happens via OTP / receipt form
    expect(fake.client.auth.admin.createUser.mock.calls[0][0]).not.toHaveProperty('password');
    expect(fake.state.updates).toContainEqual(
      expect.objectContaining({ linked_user_id: 'auth-user-1' })
    );
  });

  it('links to the winner when racing a real signup', async () => {
    // createUser fails -> the only maybeSingle call is the winner lookup.
    const fake2 = fakeSupabase({ maybeSingleValues: [{ id: 'winner-9' }] });
    fake2.client.auth.admin.createUser.mockResolvedValueOnce({
      data: null,
      error: new Error('User already been registered'),
    });

    const userId = await autoCreateGuestAccount(fake2.client, order());
    expect(userId).toBe('winner-9');
    expect(fake2.state.updates).toContainEqual(expect.objectContaining({ linked_user_id: 'winner-9' }));
  });

  it('retries profile insert without phone on unique collision', async () => {
    const collision = new Error('duplicate key value violates unique constraint "profiles_phone_number_key"');
    const fake = fakeSupabase({ insertErrors: [collision, null] });

    const userId = await autoCreateGuestAccount(fake.client, order());

    expect(userId).toBe('auth-user-1');
    expect(fake.client.from().insert).toHaveBeenCalledTimes(2);
    expect(fake.client.from().insert.mock.calls[1][0].phone_number).toBeNull();
    expect(fake.state.deletedUsers).toHaveLength(0);
  });

  it('rolls back the auth user and returns null when profile insert fails', async () => {
    const fake = fakeSupabase({ insertError: new Error('db down') });

    const userId = await autoCreateGuestAccount(fake.client, order());

    expect(userId).toBeNull();
    expect(fake.state.deletedUsers).toContain('auth-user-1');
  });
});

describe('guestSignup claim on auto-created accounts', () => {
  let guestSignup;
  let mockGetSupabaseAdmin;
  let mockGetSupabase;

  const res = () => {
    const r = {};
    r.status = jest.fn().mockReturnValue(r);
    r.json = jest.fn().mockReturnValue(r);
    return r;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ guestSignup } = await import('../controllers/guest/guestSignup.controller.js'));
    const supa = await import('../config/supabase.js');
    mockGetSupabaseAdmin = supa.getSupabaseAdmin;
    mockGetSupabase = supa.getSupabase;
  });

  const linkedOrder = () => ({
    id: 'order-1',
    guest_email: 'guest@example.com',
    guest_name: 'Ada Obi',
    guest_phone: '08030000000',
    payment_status: 'payment_success',
    receipt_token: 'tok',
    linked_user_id: 'auth-user-1',
  });

  it('sets the password and logs in when the linked account is auto-created', async () => {
    const fake = fakeSupabase({ maybeSingleValues: [linkedOrder(), { id: 'auth-user-1', email: 'guest@example.com' }] });
    fake.client.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'auth-user-1', email: 'guest@example.com', user_metadata: { auto_created: true } } },
      error: null,
    });
    mockGetSupabaseAdmin.mockReturnValue(fake.client);
    mockGetSupabase.mockReturnValue(fake.client);
    const r = res();

    await guestSignup(
      { params: { orderId: 'order-1' }, body: { receipt_token: 'tok', password: 'Secret123', password_confirmation: 'Secret123' } },
      r
    );

    expect(fake.state.updatedPasswords).toContainEqual({ id: 'auth-user-1', attrs: { password: 'Secret123' } });
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json.mock.calls[0][0].data.session).toEqual({ access_token: 'sess' });
  });

  it('keeps the 409 for orders linked to real accounts', async () => {
    const fake = fakeSupabase({ maybeSingleValues: [linkedOrder(), { id: 'auth-user-1', email: 'guest@example.com' }] });
    fake.client.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'auth-user-1', email: 'guest@example.com', user_metadata: {} } },
      error: null,
    });
    mockGetSupabaseAdmin.mockReturnValue(fake.client);
    mockGetSupabase.mockReturnValue(fake.client);
    const r = res();

    await guestSignup(
      { params: { orderId: 'order-1' }, body: { receipt_token: 'tok', password: 'Secret123', password_confirmation: 'Secret123' } },
      r
    );

    expect(r.status).toHaveBeenCalledWith(409);
    expect(fake.state.updatedPasswords).toHaveLength(0);
  });
});
