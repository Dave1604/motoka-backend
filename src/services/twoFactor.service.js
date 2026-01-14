import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { getSupabaseAdmin } from '../config/supabase.js';
import { generateOTP, generateToken } from '../utils/idGenerator.js';

const TOTP_ISSUER = process.env.TOTP_ISSUER || 'Motoka';

/**
 * Generate Google Authenticator secret and QR code
 */
export async function generateGoogleAuthSecret(userId, email) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Generate TOTP secret
  const secret = speakeasy.generateSecret({
    name: `${TOTP_ISSUER}:${email}`,
    issuer: TOTP_ISSUER,
    length: 20
  });
  
  // Store secret temporarily (not confirmed yet)
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_secret: secret.base32,
      two_factor_type: 'google',
      two_factor_enabled: false,
      two_factor_confirmed_at: null
    })
    .eq('id', userId);
  
  // Generate QR code as data URL
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  
  return {
    secret: secret.base32,
    qrCode: qrCodeUrl,
    otpauthUrl: secret.otpauth_url
  };
}

/**
 * Verify Google Authenticator TOTP code
 */
export function verifyGoogleAuthCode(secret, code) {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: code,
    window: 2 // Allow 2 time steps tolerance (60 seconds)
  });
}

/**
 * Confirm Google Authenticator setup
 */
export async function confirmGoogleAuth(userId, code) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Get user's secret
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_secret')
    .eq('id', userId)
    .single();
  
  if (error || !profile?.two_factor_secret) {
    throw new Error('2FA not initialized. Please start setup first.');
  }
  
  // Verify the code
  const isValid = verifyGoogleAuthCode(profile.two_factor_secret, code);
  
  if (!isValid) {
    throw new Error('Invalid verification code');
  }
  
  // Generate recovery codes
  const recoveryCodes = Array.from({ length: 8 }, () => generateToken(8).toUpperCase());
  
  // Confirm 2FA
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_enabled: true,
      two_factor_confirmed_at: new Date().toISOString(),
      two_factor_recovery_codes: recoveryCodes
    })
    .eq('id', userId);
  
  return recoveryCodes;
}

/**
 * Generate and store email 2FA code
 */
export async function generateEmail2FACode(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_email_code: code,
      two_factor_email_expires_at: expiresAt.toISOString()
    })
    .eq('id', userId);
  
  return code;
}

/**
 * Verify email 2FA code
 */
export async function verifyEmail2FACode(userId, code) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_email_code, two_factor_email_expires_at')
    .eq('id', userId)
    .single();
  
  if (error || !profile) {
    throw new Error('User not found');
  }
  
  if (!profile.two_factor_email_code) {
    throw new Error('No 2FA code pending');
  }
  
  if (new Date(profile.two_factor_email_expires_at) < new Date()) {
    throw new Error('2FA code has expired');
  }
  
  if (profile.two_factor_email_code !== code) {
    throw new Error('Invalid 2FA code');
  }
  
  // Clear the code
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_email_code: null,
      two_factor_email_expires_at: null
    })
    .eq('id', userId);
  
  return true;
}

/**
 * Enable email-based 2FA
 */
export async function enableEmail2FA(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_enabled: true,
      two_factor_type: 'email',
      two_factor_confirmed_at: new Date().toISOString(),
      two_factor_secret: null // Clear any Google Auth secret
    })
    .eq('id', userId);
  
  return true;
}

/**
 * Disable 2FA
 */
export async function disable2FA(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_enabled: false,
      two_factor_type: null,
      two_factor_secret: null,
      two_factor_recovery_codes: null,
      two_factor_confirmed_at: null,
      two_factor_email_code: null,
      two_factor_email_expires_at: null
    })
    .eq('id', userId);
  
  return true;
}

/**
 * Get 2FA status
 */
export async function get2FAStatus(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_enabled, two_factor_type, two_factor_confirmed_at')
    .eq('id', userId)
    .single();
  
  if (error || !profile) {
    throw new Error('User not found');
  }
  
  return {
    enabled: profile.two_factor_enabled || false,
    method: profile.two_factor_type,
    confirmed_at: profile.two_factor_confirmed_at
  };
}

/**
 * Create temporary login token for 2FA verification
 */
export async function create2FALoginToken(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const token = generateToken(64);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_login_token: token,
      two_factor_login_expires_at: expiresAt.toISOString()
    })
    .eq('id', userId);
  
  return token;
}

/**
 * Verify 2FA login token
 */
export async function verify2FALoginToken(userId, token) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_login_token, two_factor_login_expires_at')
    .eq('id', userId)
    .single();
  
  if (error || !profile) {
    throw new Error('User not found');
  }
  
  if (!profile.two_factor_login_token) {
    throw new Error('No login pending');
  }
  
  if (new Date(profile.two_factor_login_expires_at) < new Date()) {
    throw new Error('Login session expired');
  }
  
  if (profile.two_factor_login_token !== token) {
    throw new Error('Invalid login token');
  }
  
  // Clear the token
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_login_token: null,
      two_factor_login_expires_at: null
    })
    .eq('id', userId);
  
  return true;
}

/**
 * Verify recovery code
 */
export async function verifyRecoveryCode(userId, code) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_recovery_codes')
    .eq('id', userId)
    .single();
  
  if (error || !profile?.two_factor_recovery_codes) {
    throw new Error('No recovery codes found');
  }
  
  const codes = profile.two_factor_recovery_codes;
  const upperCode = code.toUpperCase();
  
  if (!codes.includes(upperCode)) {
    throw new Error('Invalid recovery code');
  }
  
  // Remove used code
  const remainingCodes = codes.filter(c => c !== upperCode);
  
  await supabaseAdmin
    .from('profiles')
    .update({
      two_factor_recovery_codes: remainingCodes
    })
    .eq('id', userId);
  
  return {
    remainingCodes: remainingCodes.length
  };
}
