import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { getSupabaseAdmin } from '../config/supabase.js';
import { generateOTP, generateToken } from '../utils/idGenerator.js';
import { send2FACode as sendEmail2FACode } from './email/email.service.js';

const TOTP_ISSUER = process.env.TOTP_ISSUER || 'Motoka';

export async function generateGoogleAuthSecret(userId, email) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const secret = speakeasy.generateSecret({
    name: `${TOTP_ISSUER}:${email}`,
    issuer: TOTP_ISSUER,
    length: 20
  });
  
  await supabaseAdmin.from('profiles').update({
    two_factor_secret: secret.base32,
    two_factor_type: 'google',
    two_factor_enabled: false,
    two_factor_confirmed_at: null
  }).eq('id', userId);
  
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  
  return { secret: secret.base32, qrCode: qrCodeUrl, otpauthUrl: secret.otpauth_url };
}

export function verifyGoogleAuthCode(secret, code) {
  return speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 2 });
}

export async function confirmGoogleAuth(userId, code) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_secret')
    .eq('id', userId)
    .single();
  
  if (!profile?.two_factor_secret) {
    throw new Error('2FA not initialized');
  }
  
  if (!verifyGoogleAuthCode(profile.two_factor_secret, code)) {
    throw new Error('Invalid verification code');
  }
  
  const recoveryCodes = Array.from({ length: 8 }, () => generateToken(8).toUpperCase());
  
  await supabaseAdmin.from('profiles').update({
    two_factor_enabled: true,
    two_factor_confirmed_at: new Date().toISOString(),
    two_factor_recovery_codes: recoveryCodes
  }).eq('id', userId);
  
  return recoveryCodes;
}

export async function generateEmail2FACode(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  
  // Get user email for sending
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single();
  
  if (!profile?.email) {
    throw new Error('User email not found');
  }
  
  await supabaseAdmin.from('profiles').update({
    two_factor_email_code: code,
    two_factor_email_expires_at: expiresAt.toISOString()
  }).eq('id', userId);
  
  // SECURITY: Send code via email (Resend), never log code value
  try {
    await sendEmail2FACode({ to: profile.email, code });
  } catch (emailError) {
    console.error('[2FA] Email send failed for user:', userId, emailError.message);
    throw new Error('Failed to send 2FA code');
  }
  
  return code;
}

export async function verifyEmail2FACode(userId, code) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_email_code, two_factor_email_expires_at')
    .eq('id', userId)
    .single();
  
  if (!profile?.two_factor_email_code) throw new Error('No 2FA code pending');
  if (new Date(profile.two_factor_email_expires_at) < new Date()) throw new Error('2FA code expired');
  if (profile.two_factor_email_code !== code) throw new Error('Invalid 2FA code');
  
  await supabaseAdmin.from('profiles').update({
    two_factor_email_code: null,
    two_factor_email_expires_at: null
  }).eq('id', userId);
  
  return true;
}

export async function enableEmail2FA(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  await supabaseAdmin.from('profiles').update({
    two_factor_enabled: true,
    two_factor_type: 'email',
    two_factor_confirmed_at: new Date().toISOString(),
    two_factor_secret: null
  }).eq('id', userId);
  
  return true;
}

export async function disable2FA(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  await supabaseAdmin.from('profiles').update({
    two_factor_enabled: false,
    two_factor_type: null,
    two_factor_secret: null,
    two_factor_recovery_codes: null,
    two_factor_confirmed_at: null,
    two_factor_email_code: null,
    two_factor_email_expires_at: null
  }).eq('id', userId);
  
  return true;
}

export async function get2FAStatus(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_enabled, two_factor_type, two_factor_confirmed_at')
    .eq('id', userId)
    .single();
  
  if (!profile) throw new Error('User not found');
  
  return {
    enabled: profile.two_factor_enabled || false,
    method: profile.two_factor_type,
    confirmed_at: profile.two_factor_confirmed_at
  };
}

export async function create2FALoginToken(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const token = generateToken(64);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  
  await supabaseAdmin.from('profiles').update({
    two_factor_login_token: token,
    two_factor_login_expires_at: expiresAt.toISOString()
  }).eq('id', userId);
  
  return token;
}

export async function verify2FALoginToken(userId, token) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_login_token, two_factor_login_expires_at')
    .eq('id', userId)
    .single();
  
  if (!profile?.two_factor_login_token) throw new Error('No login pending');
  if (new Date(profile.two_factor_login_expires_at) < new Date()) throw new Error('Login session expired');
  if (profile.two_factor_login_token !== token) throw new Error('Invalid login token');
  
  await supabaseAdmin.from('profiles').update({
    two_factor_login_token: null,
    two_factor_login_expires_at: null
  }).eq('id', userId);
  
  return true;
}

export async function verifyRecoveryCode(userId, code) {
  const supabaseAdmin = getSupabaseAdmin();
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('two_factor_recovery_codes')
    .eq('id', userId)
    .single();
  
  if (!profile?.two_factor_recovery_codes) throw new Error('No recovery codes found');
  
  const upperCode = code.toUpperCase();
  if (!profile.two_factor_recovery_codes.includes(upperCode)) throw new Error('Invalid recovery code');
  
  const remainingCodes = profile.two_factor_recovery_codes.filter(c => c !== upperCode);
  
  await supabaseAdmin.from('profiles').update({ two_factor_recovery_codes: remainingCodes }).eq('id', userId);
  
  return { remainingCodes: remainingCodes.length };
}
