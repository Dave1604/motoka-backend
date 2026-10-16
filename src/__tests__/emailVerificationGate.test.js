import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Supabase auto-confirms every signup, so email_confirmed_at proves nothing.
// These tests pin the app-level gate: profiles.email_verified_at decides.

const mockGetUser = jest.fn();
const mockProfile = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignInWithOtp = jest.fn();

jest.unstable_mockModule('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    auth: { getUser: (...a) => mockGetUser(...a) },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => mockProfile(), maybeSingle: () => mockProfile() }) }),
      update: () => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) }),
    }),
  }),
  getSupabase: () => ({
    auth: {
      signInWithPassword: (...a) => mockSignInWithPassword(...a),
      signInWithOtp: (...a) => mockSignInWithOtp(...a),
    },
  }),
}));
jest.unstable_mockModule('../services/twoFactor.service.js', () => ({
  create2FALoginToken: jest.fn(), generateEmail2FACode: jest.fn(),
}));
jest.unstable_mockModule('../services/referral/referral.service.js', () => ({
  attributeReferral: jest.fn(), ensureReferralCode: jest.fn(),
}));

const { authenticate } = await import('../middleware/authenticate.js');
const { checkEmailVerified } = await import('../middleware/checkEmailVerified.js');
const { login } = await import('../controllers/auth.controller.js');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const user = (id) => ({ id, email: `${id}@example.com`, email_confirmed_at: '2026-01-01T00:00:00Z' });

describe('email verification gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('authenticate refuses a session whose profile is not verified', async () => {
    mockGetUser.mockResolvedValue({ data: { user: user('u-unverified') }, error: null });
    mockProfile.mockResolvedValue({ data: { id: 'u-unverified', email_verified_at: null }, error: null });
    const req = { headers: { authorization: 'Bearer t' } };
    const res = mockRes(); const next = jest.fn();
    await authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Please verify your email before logging in.' }));
  });

  it('authenticate lets a verified profile through even though auth auto-confirmed it', async () => {
    mockGetUser.mockResolvedValue({ data: { user: user('u-ok') }, error: null });
    mockProfile.mockResolvedValue({ data: { id: 'u-ok', email_verified_at: '2026-02-01T00:00:00Z' }, error: null });
    const req = { headers: { authorization: 'Bearer t' } };
    const res = mockRes(); const next = jest.fn();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.profile.email_verified_at).toBeTruthy();
  });

  it('checkEmailVerified reads the profile flag, not the auth flag', () => {
    const res = mockRes(); const next = jest.fn();
    checkEmailVerified({ user: { email_confirmed_at: 'x', profile: { email_verified_at: null } } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const next2 = jest.fn();
    checkEmailVerified({ user: { profile: { email_verified_at: 'x' } } }, mockRes(), next2);
    expect(next2).toHaveBeenCalled();
  });

  it('password login refuses an unverified profile and resends the code', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: user('u-new'), session: { access_token: 'should-not-leak' } }, error: null });
    mockProfile.mockResolvedValue({ data: { id: 'u-new', email_verified_at: null }, error: null });
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const res = mockRes();
    await login({ body: { email: 'u-new@example.com', password: 'pw' } }, res);
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'u-new@example.com', options: { shouldCreateUser: false } });
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Please verify your email before logging in.');
    expect(JSON.stringify(body)).not.toContain('should-not-leak');
  });

  it('password login succeeds for a verified profile', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: user('u-ok'), session: { access_token: 'tok' } }, error: null });
    mockProfile.mockResolvedValue({ data: { id: 'u-ok', email_verified_at: '2026-02-01T00:00:00Z' }, error: null });
    const res = mockRes();
    await login({ body: { email: 'u-ok@example.com', password: 'pw' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.session.access_token).toBe('tok');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });
});
