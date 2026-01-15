import * as response from '../utils/responses.js';
import * as twoFactorService from '../services/twoFactor.service.js';
import { getSupabaseAdmin } from '../config/supabase.js';

export const enableGoogleAuth = async (req, res) => {
  try {
    const { id: userId, email } = req.user;
    
    const status = await twoFactorService.get2FAStatus(userId);
    if (status.enabled) {
      return response.error(res, '2FA is already enabled');
    }
    
    const { secret, qrCode, otpauthUrl } = await twoFactorService.generateGoogleAuthSecret(userId, email);
    
    return response.success(res, { secret, qr_code: qrCode, otpauth_url: otpauthUrl }, 'Scan QR code with Google Authenticator');
  } catch (error) {
    console.error('Enable Google Auth error:', error);
    return response.serverError(res, 'Failed to enable Google Authenticator');
  }
};

export const verifyGoogleAuth = async (req, res) => {
  try {
    const { code } = req.body;
    const recoveryCodes = await twoFactorService.confirmGoogleAuth(req.user.id, code);
    
    return response.success(res, {
      enabled: true,
      method: 'google',
      recovery_codes: recoveryCodes
    }, 'Google Authenticator enabled');
  } catch (error) {
    console.error('Verify Google Auth error:', error);
    return response.error(res, error.message || 'Verification failed');
  }
};

export const enableEmailAuth = async (req, res) => {
  try {
    const status = await twoFactorService.get2FAStatus(req.user.id);
    if (status.enabled) {
      return response.error(res, '2FA is already enabled');
    }
    
    await twoFactorService.enableEmail2FA(req.user.id);
    
    return response.success(res, { enabled: true, method: 'email' }, 'Email 2FA enabled');
  } catch (error) {
    console.error('Enable Email Auth error:', error);
    return response.serverError(res, 'Failed to enable email 2FA');
  }
};

export const verifyEmailAuth = async (req, res) => {
  try {
    await twoFactorService.verifyEmail2FACode(req.user.id, req.body.code);
    return response.success(res, { verified: true }, 'Email 2FA code verified');
  } catch (error) {
    console.error('Verify Email Auth error:', error);
    return response.error(res, error.message || 'Verification failed');
  }
};

export const disable2FA = async (req, res) => {
  try {
    const { password } = req.body;
    const supabaseAdmin = getSupabaseAdmin();
    
    if (!password) {
      return response.error(res, 'Password is required');
    }
    
    const { error } = await supabaseAdmin.auth.signInWithPassword({ email: req.user.email, password });
    
    if (error) {
      return response.error(res, 'Invalid password');
    }
    
    await twoFactorService.disable2FA(req.user.id);
    
    return response.success(res, { enabled: false }, '2FA disabled');
  } catch (error) {
    console.error('Disable 2FA error:', error);
    return response.serverError(res, 'Failed to disable 2FA');
  }
};

export const get2FAStatus = async (req, res) => {
  try {
    const status = await twoFactorService.get2FAStatus(req.user.id);
    return response.success(res, status);
  } catch (error) {
    console.error('Get 2FA status error:', error);
    return response.serverError(res, 'Failed to get 2FA status');
  }
};

export const sendEmail2FACode = async (req, res) => {
  try {
    const status = await twoFactorService.get2FAStatus(req.user.id);
    if (!status.enabled || status.method !== 'email') {
      return response.error(res, 'Email 2FA is not enabled');
    }
    
    await twoFactorService.generateEmail2FACode(req.user.id);
    
    return response.success(res, null, '2FA code sent to your email');
  } catch (error) {
    console.error('Send 2FA code error:', error);
    return response.serverError(res, 'Failed to send 2FA code');
  }
};

export const verifyRecoveryCode = async (req, res) => {
  try {
    const { code, user_id, temp_token } = req.body;
    
    if (!code || !user_id || !temp_token) {
      return response.error(res, 'Recovery code, user ID, and temp token are required');
    }
    
    await twoFactorService.verify2FALoginToken(user_id, temp_token);
    const result = await twoFactorService.verifyRecoveryCode(user_id, code);
    
    return response.success(res, {
      verified: true,
      remaining_codes: result.remainingCodes
    }, 'Recovery code verified');
  } catch (error) {
    console.error('Verify recovery code error:', error);
    return response.error(res, error.message || 'Invalid recovery code');
  }
};
