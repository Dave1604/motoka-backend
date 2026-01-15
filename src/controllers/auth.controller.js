import { getSupabase, getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import * as twoFactorService from '../services/twoFactor.service.js';

export const register = async (req, res) => {
  try {
    const { first_name, last_name, email, phone, password } = req.body;
    const supabase = getSupabase();
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name, last_name, phone } }
    });
    
    if (error) {
      if (error.message.includes('already registered')) {
        return response.error(res, 'Email already registered', 409);
      }
      return response.error(res, error.message);
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    return response.created(res, {
      user: { id: data.user.id, email: data.user.email, email_verified: !!data.user.email_confirmed_at, ...profile },
      session: data.session
    }, 'Registration successful. Please check your email to verify your account.');
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
      return response.unauthorized(res, 'Invalid email or password');
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
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
      user: { id: data.user.id, email: data.user.email, email_verified: !!data.user.email_confirmed_at, ...profile },
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
    
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email === email);
    
    if (!user) {
      return response.success(res, null, 'If an account exists, an OTP has been sent to your email');
    }
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    
    await supabaseAdmin
      .from('password_reset_tokens')
      .upsert({ email, otp, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString() }, { onConflict: 'email' });
    
    console.log(`[OTP] Password reset for ${email}: ${otp}`);
    
    return response.success(res, null, 'OTP sent to your email');
  } catch (error) {
    console.error('Send OTP error:', error);
    return response.serverError(res, 'Failed to send OTP');
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
    
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email === email);
    
    if (!user) {
      return response.error(res, 'User not found');
    }
    
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
    
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
    
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    
    if (error) {
      if (error.message.includes('User not found')) {
        return response.success(res, null, 'If an account exists, an OTP has been sent to your email');
      }
      return response.error(res, error.message);
    }
    
    return response.success(res, null, 'OTP sent to your email');
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
    
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    
    if (error) {
      return response.error(res, error.message);
    }
    
    return response.success(res, null, 'Verification email sent');
  } catch (error) {
    console.error('Resend verification error:', error);
    return response.serverError(res, 'Failed to resend verification email');
  }
};

export const me = async (req, res) => {
  try {
    return response.success(res, {
      user: { id: req.user.id, email: req.user.email, email_verified: !!req.user.email_confirmed_at, ...req.user.profile }
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
    const { data: fullProfile } = await supabaseAdmin.from('profiles').select('*').eq('id', user_id).single();
    
    return response.success(res, {
      user: { id: user.id, email: user.email, email_verified: !!user.email_confirmed_at, ...fullProfile }
    }, '2FA verified successfully');
  } catch (error) {
    console.error('2FA verify login error:', error);
    return response.error(res, error.message || '2FA verification failed');
  }
};
