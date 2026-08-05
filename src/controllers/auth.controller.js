import { getSupabase, getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import * as twoFactorService from '../services/twoFactor.service.js';
import { sendPasswordResetOTP as sendPasswordResetEmail } from '../services/email/email.service.js';
import {
  attributeReferral,
  ensureReferralCode,
} from '../services/referral/referral.service.js';

// Fields that must never appear in any API response (KAGE-003, KAGE-005)
const SAFE_PROFILE_FIELDS = [
  'id', 'user_id', 'first_name', 'last_name', 'phone_number', 'email',
  'image', 'nin', 'address', 'gender', 'user_type', 'user_type_id',
  'is_admin', 'is_suspended', 'two_factor_enabled', 'two_factor_type',
  'two_factor_confirmed_at', 'created_at', 'updated_at',
];

function sanitizeProfile(profile) {
  if (!profile) return null;
  return Object.fromEntries(
    SAFE_PROFILE_FIELDS.filter(k => k in profile).map(k => [k, profile[k]])
  );
}

const SAFE_PROFILE_SELECT = 'id, user_id, first_name, last_name, phone_number, email, image, nin, address, gender, user_type, user_type_id, is_admin, is_suspended, deleted_at, two_factor_enabled, two_factor_type, two_factor_confirmed_at, created_at, updated_at';

export const register = async (req, res) => {
  try {
    const { first_name, last_name, email, phone, password, referral_code } = req.body;
    const supabase = getSupabase();
    const supabaseAdmin = getSupabaseAdmin();

    // Check if a profile with this phone already exists (would block insert)
    if (phone) {
      const { data: existingPhone } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone_number', phone)
        .maybeSingle();
      if (existingPhone) {
        return response.error(res, 'Phone number already in use', 409);
      }
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name, last_name, phone },
        emailRedirectTo: undefined
      }
    });

    if (error) {
      if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already been registered')) {
        return response.error(res, 'Email already registered', 409);
      }
      // "Database error saving new user" means the DB trigger failed — handle profile manually
      if (error.message.toLowerCase().includes('database error')) {
        return response.error(res, 'Registration failed. Please try again or contact support.', 500);
      }
      return response.error(res, error.message);
    }

    const userId = data.user.id;

    // Explicitly upsert profile — don't rely solely on the DB trigger
    // This handles cases where the trigger fails (e.g. NOT NULL email constraint added after trigger was created)
    let profile = null;
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select(SAFE_PROFILE_SELECT)
      .eq('id', userId)
      .maybeSingle();

    if (!existingProfile) {
      // Generate a unique 6-char user_id
      let newUserId;
      for (let i = 0; i < 10; i++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: conflict } = await supabaseAdmin
          .from('profiles').select('id').eq('user_id', candidate).maybeSingle();
        if (!conflict) { newUserId = candidate; break; }
      }

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          user_id: newUserId,
          first_name: first_name || email.split('@')[0],
          last_name: last_name || '',
          phone_number: phone || null,
          email,
          user_type_id: 2
        })
        .select(SAFE_PROFILE_SELECT)
        .single();

      if (insertError) {
        console.error('[Register] Profile insert failed:', insertError);
        // Auth user was created — delete it to avoid orphaned auth records
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        return response.error(res, 'Registration failed. Please try again.', 500);
      }
      profile = inserted;
    } else {
      profile = existingProfile;
    }

    // Send OTP for email verification
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    }).catch(() => {}); // non-fatal if OTP fails

    // Referral: attribute if code provided, then ensure this user has a share code.
    // Never fail registration because of referral errors.
    try {
      if (referral_code) {
        await attributeReferral({ refereeId: userId, code: referral_code });
      }
      await ensureReferralCode(userId);
    } catch (referralErr) {
      console.error('[Register] Referral hook failed (non-fatal):', referralErr?.message || referralErr);
    }

    return response.created(res, {
      user: { id: userId, email: data.user.email, email_verified: !!data.user.email_confirmed_at, ...sanitizeProfile(profile) },
      session: data.session
    }, 'Registration successful. Please check your email for verification code.');
  } catch (error) {
    console.error('Registration error:', error);
    return response.serverError(res, 'Registration failed');
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const supabase = getSupabase();
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      console.error('[LOGIN ERROR]', {
        email,
        errorMessage: error.message,
        errorStatus: error.status,
        errorCode: error.code
      });
      return response.unauthorized(res, 'Invalid email or password');
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select(SAFE_PROFILE_SELECT)
      .eq('id', data.user.id)
      .single();

    if (profile?.is_suspended) {
      return response.forbidden(res, 'Your account has been suspended');
    }

    if (profile?.deleted_at) {
      return response.forbidden(res, 'Your account has been deleted');
    }

    if (profile?.two_factor_enabled) {
      const tempToken = await twoFactorService.create2FALoginToken(data.user.id);

      if (profile.two_factor_type === 'email') {
        await twoFactorService.generateEmail2FACode(data.user.id);
      }

      return response.success(res, {
        requires_2fa: true,
        two_factor_method: profile.two_factor_type,
        temp_token: tempToken,
        user_id: data.user.id
      }, '2FA verification required');
    }

    return response.success(res, {
      user: { id: data.user.id, email: data.user.email, email_verified: !!data.user.email_confirmed_at, ...sanitizeProfile(profile) },
      session: data.session
    }, 'Login successful');
  } catch (error) {
    console.error('Login error:', error);
    return response.serverError(res, 'Login failed');
  }
};

export const logout = async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    return response.success(res, null, 'Logged out successfully');
  } catch (error) {
    console.error('Logout error:', error);
    return response.serverError(res, 'Logout failed');
  }
};

export const refresh = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    const supabase = getSupabase();
    
    if (!refresh_token) {
      return response.error(res, 'Refresh token is required');
    }
    
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    
    if (error) {
      return response.unauthorized(res, 'Invalid refresh token');
    }
    
    return response.success(res, { session: data.session }, 'Token refreshed successfully');
  } catch (error) {
    console.error('Refresh error:', error);
    return response.serverError(res, 'Token refresh failed');
  }
};

export const sendPasswordResetOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    // SCALABILITY FIX: Don't reveal if email exists (security best practice)
    // Generate OTP regardless - if user doesn't exist, OTP won't be usable anyway
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    
    await supabaseAdmin
      .from('password_reset_tokens')
      .upsert({ email, otp, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString() }, { onConflict: 'email' });
    
    // SECURITY: Send OTP via email (Resend), never log OTP value
    try {
      await sendPasswordResetEmail({ to: email, otp });
    } catch (emailError) {
      // Log error server-side but don't reveal to user
      console.error('[Password Reset] Email send failed:', emailError.message);
      // Still return success to avoid revealing if email exists
    }
    
    return response.success(res, null, 'If your email is registered, you will receive a password reset code');
  } catch (error) {
    console.error('Send OTP error:', error);
    return response.serverError(res, 'Failed to process password reset request');
  }
};

export const verifyPasswordResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: tokenData, error } = await supabaseAdmin
      .from('password_reset_tokens')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !tokenData) {
      return response.error(res, 'No password reset request found');
    }
    
    if (new Date(tokenData.expires_at) < new Date()) {
      return response.error(res, 'OTP has expired');
    }
    
    if (tokenData.otp !== otp) {
      return response.error(res, 'Invalid OTP');
    }
    
    const resetToken = Array.from({ length: 64 }, () => 
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))
    ).join('');
    
    await supabaseAdmin.from('password_reset_tokens').update({ token: resetToken }).eq('email', email);
    
    return response.success(res, { reset_token: resetToken }, 'OTP verified');
  } catch (error) {
    console.error('Verify OTP error:', error);
    return response.serverError(res, 'OTP verification failed');
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, token, password } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: tokenData, error } = await supabaseAdmin
      .from('password_reset_tokens')
      .select('*')
      .eq('email', email)
      .eq('token', token)
      .single();
    
    if (error || !tokenData) {
      return response.error(res, 'Invalid reset token');
    }
    
    const tokenExpiry = new Date(tokenData.expires_at);
    tokenExpiry.setMinutes(tokenExpiry.getMinutes() + 5);
    
    if (tokenExpiry < new Date()) {
      return response.error(res, 'Reset token has expired');
    }
    
    // SCALABILITY FIX: Query profiles table to get user ID instead of listing all users
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();
    
    if (!profile) {
      return response.error(res, 'User not found');
    }
    
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password });
    
    if (updateError) {
      return response.error(res, updateError.message);
    }
    
    await supabaseAdmin.from('password_reset_tokens').delete().eq('email', email);
    
    return response.success(res, null, 'Password reset successfully');
  } catch (error) {
    console.error('Reset password error:', error);
    return response.serverError(res, 'Password reset failed');
  }
};

export const sendLoginOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const supabase = getSupabase();
    
    const { data, error } = await supabase.auth.signInWithOtp({ 
      email, 
      options: { shouldCreateUser: false } // Don't create new users via OTP login
    });
    
    if (error) {
      return response.error(res, error.message || 'Failed to send OTP');
    }
    
    return response.success(res, data, 'OTP sent to your email');
  } catch (error) {
    console.error('Send login OTP error:', error);
    return response.serverError(res, 'Failed to send OTP');
  }
};

export const verifyLoginOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const supabase = getSupabase();
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data, error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    
    if (error) {
      return response.error(res, 'Invalid or expired OTP');
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    if (profile?.is_suspended) {
      return response.forbidden(res, 'Your account has been suspended');
    }
    
    if (profile?.two_factor_enabled) {
      const tempToken = await twoFactorService.create2FALoginToken(data.user.id);
      
      if (profile.two_factor_type === 'email') {
        await twoFactorService.generateEmail2FACode(data.user.id);
      }
      
      return response.success(res, {
        requires_2fa: true,
        two_factor_method: profile.two_factor_type,
        temp_token: tempToken,
        user_id: data.user.id
      }, '2FA verification required');
    }
    
    return response.success(res, {
      user: { id: data.user.id, email: data.user.email, email_verified: !!data.user.email_confirmed_at, ...profile },
      session: data.session
    }, 'Login successful');
  } catch (error) {
    console.error('Verify login OTP error:', error);
    return response.serverError(res, 'OTP verification failed');
  }
};

export const resendEmailVerification = async (req, res) => {
  try {
    const { email } = req.body;
    const supabase = getSupabase();
    
    // Use signInWithOtp instead of resend({ type: 'signup' }) - OTP emails work with Brevo
    const { error } = await supabase.auth.signInWithOtp({ 
      email,
      options: { shouldCreateUser: false }
    });
    
    if (error) {
      return response.error(res, error.message);
    }
    
    return response.success(res, null, 'Verification code sent to your email');
  } catch (error) {
    console.error('Resend verification error:', error);
    return response.serverError(res, 'Failed to resend verification code');
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const supabase = getSupabase();
    const supabaseAdmin = getSupabaseAdmin();
    
    // Use type: 'email' since we send OTP via signInWithOtp (not signup confirmation)
    const { data, error } = await supabase.auth.verifyOtp({ 
      email, 
      token: otp, 
      type: 'email' 
    });
    
    if (error) {
      return response.error(res, 'Invalid or expired verification code');
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    return response.success(res, {
      user: { 
        id: data.user.id, 
        email: data.user.email, 
        email_verified: true,
        ...profile 
      },
      session: data.session
    }, 'Email verified successfully');
  } catch (error) {
    console.error('Email verification error:', error);
    return response.serverError(res, 'Email verification failed');
  }
};

export const me = async (req, res) => {
  try {
    return response.success(res, {
      user: { id: req.user.id, email: req.user.email, email_verified: !!req.user.email_confirmed_at, ...sanitizeProfile(req.user.profile) }
    });
  } catch (error) {
    console.error('Get user error:', error);
    return response.serverError(res, 'Failed to get user');
  }
};

export const verify2FALogin = async (req, res) => {
  try {
    const { user_id, temp_token, code } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    if (!user_id || !temp_token || !code) {
      return response.error(res, 'User ID, temp token, and code are required');
    }
    
    await twoFactorService.verify2FALoginToken(user_id, temp_token);
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('two_factor_type, two_factor_secret')
      .eq('id', user_id)
      .single();
    
    if (!profile) {
      return response.error(res, 'User not found');
    }
    
    let isValid = false;
    
    if (profile.two_factor_type === 'google') {
      isValid = twoFactorService.verifyGoogleAuthCode(profile.two_factor_secret, code);
    } else if (profile.two_factor_type === 'email') {
      try {
        await twoFactorService.verifyEmail2FACode(user_id, code);
        isValid = true;
      } catch {
        isValid = false;
      }
    }
    
    if (!isValid) {
      return response.error(res, 'Invalid 2FA code');
    }
    
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(user_id);
    const { data: fullProfile } = await supabaseAdmin.from('profiles').select(SAFE_PROFILE_SELECT).eq('id', user_id).single();

    return response.success(res, {
      user: { id: user.id, email: user.email, email_verified: !!user.email_confirmed_at, ...sanitizeProfile(fullProfile) }
    }, '2FA verified successfully');
  } catch (error) {
    console.error('2FA verify login error:', error);
    return response.error(res, error.message || '2FA verification failed');
  }
};
