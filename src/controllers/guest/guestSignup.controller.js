/**
 * GUEST SIGNUP CONTROLLER
 *
 * POST /api/guest/renewals/:orderId/signup
 *   - Validates receipt_token
 *   - Creates a full Supabase auth user from the guest's email + chosen password
 *   - Links the guest_renewal_order to the new user
 *   - Returns session tokens in the same shape as the existing auth endpoints
 *     so the frontend can reuse authStorage.setToken() / authStorage.setUserInfo()
 */

import { getSupabase, getSupabaseAdmin } from '../../config/supabase.js';
import * as response from '../../utils/responses.js';
import { logError, logInfo } from '../../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/guest/renewals/:orderId/signup
// ─────────────────────────────────────────────────────────────────────────────

export const guestSignup = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { receipt_token, password, password_confirmation } = req.body;

    // ── Field validation ─────────────────────────────────────────────────────
    if (!receipt_token?.trim()) {
      return response.error(res, 'receipt_token is required', 400);
    }
    if (!password?.trim()) {
      return response.error(res, 'password is required', 400);
    }
    if (password !== password_confirmation) {
      return response.error(res, 'Passwords do not match', 400);
    }
    if (password.length < 8) {
      return response.error(res, 'Password must be at least 8 characters', 400);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const supabase = getSupabase();

    // ── Fetch the guest order and verify token ────────────────────────────────
    const { data: order, error: orderError } = await supabaseAdmin
      .from('guest_renewal_orders')
      .select('id, guest_email, guest_name, guest_phone, payment_status, receipt_token, linked_user_id')
      .eq('id', orderId)
      .eq('receipt_token', receipt_token)
      .maybeSingle();

    if (orderError || !order) {
      return response.error(res, 'Invalid order or receipt token', 400);
    }

    if (order.payment_status !== 'payment_success') {
      return response.error(res, 'Payment has not been confirmed for this order', 400);
    }

    if (order.linked_user_id) {
      return response.error(res, 'An account has already been created for this order', 409);
    }

    const email = order.guest_email;

    // ── Check if an account already exists for this email ────────────────────
    // profiles.id = auth.users.id, and email is indexed there — faster than auth.admin.listUsers
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    const existingUser = existingProfile ? { id: existingProfile.id } : null;

    if (existingUser) {
      // Account already exists — link order to existing user and ask them to log in
      await supabaseAdmin
        .from('guest_renewal_orders')
        .update({ linked_user_id: existingUser.id, updated_at: new Date().toISOString() })
        .eq('id', orderId);

      return response.error(
        res,
        'An account already exists with this email. Please log in to view your renewals.',
        409
      );
    }

    // ── Create Supabase auth user ─────────────────────────────────────────────
    const nameParts = (order.guest_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName, phone: order.guest_phone }
      }
    });

    if (signUpError) {
      logError('[GuestSignup] signUp failed', signUpError);
      if (signUpError.message?.toLowerCase().includes('already registered')) {
        return response.error(res, 'An account already exists with this email. Please log in.', 409);
      }
      return response.serverError(res, 'Account creation failed. Please try again.');
    }

    const userId = signUpData.user.id;

    // ── Ensure profile row exists ─────────────────────────────────────────────
    const { data: profileById } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!profileById) {
      let newUserId;
      for (let i = 0; i < 10; i++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: conflict } = await supabaseAdmin
          .from('profiles').select('id').eq('user_id', candidate).maybeSingle();
        if (!conflict) { newUserId = candidate; break; }
      }

      if (!newUserId) {
        logError('[GuestSignup] Could not generate unique user_id after 10 attempts', { userId });
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        return response.serverError(res, 'Account creation failed. Please try again.');
      }

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          user_id: newUserId,
          first_name: firstName,
          last_name: lastName,
          phone_number: order.guest_phone || null,
          email,
          user_type_id: 2
        });

      if (profileError) {
        logError('[GuestSignup] Profile insert failed', profileError);
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        return response.serverError(res, 'Account creation failed. Please try again.');
      }
    }

    // ── Link the renewal order to the new user ────────────────────────────────
    await supabaseAdmin
      .from('guest_renewal_orders')
      .update({ linked_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    logInfo('[GuestSignup] Account created and order linked', { userId, orderId });

    // ── Send OTP for email verification (reuses existing Supabase OTP flow) ───
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    }).catch(() => {}); // non-fatal

    // ── Return same shape as existing /register endpoint ──────────────────────
    return response.created(res, {
      user: {
        id: userId,
        email,
        email_verified: false,
        first_name: firstName,
        last_name: lastName
      },
      session: signUpData.session
    }, 'Account created. Please check your email for the verification code.');
  } catch (error) {
    logError('[GuestSignup] Unexpected error', error);
    return response.serverError(res, 'Account creation failed');
  }
};
