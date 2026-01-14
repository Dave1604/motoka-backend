import * as response from '../utils/responses.js';
import * as twoFactorService from '../services/twoFactor.service.js';
import { getSupabaseAdmin } from '../config/supabase.js';

/**
 * POST /api/2fa/enable-google
 * Start Google Authenticator 2FA setup
 */
export const enableGoogleAuth = async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;
    
    // Check if already enabled
    const status = await twoFactorService.get2FAStatus(userId);
    if (status.enabled) {
      return response.error(res, '2FA is already enabled. Disable it first to change methods.');
    }
    
    // Generate secret and QR code
    const { secret, qrCode, otpauthUrl } = await twoFactorService.generateGoogleAuthSecret(userId, email);
    
    return response.success(res, {
      secret,
      qr_code: qrCode,
      otpauth_url: otpauthUrl,
      message: 'Scan the QR code with Google Authenticator, then verify with a code'
    }, 'Google Authenticator setup initiated');
    
  } catch (error) {
    console.error('Enable Google Auth error:', error);
    return response.serverError(res, 'Failed to enable Google Authenticator');
  }
};

/**
 * POST /api/2fa/verify-google
 * Verify and confirm Google Authenticator setup
 */
export const verifyGoogleAuth = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;
    
    // Confirm the setup
    const recoveryCodes = await twoFactorService.confirmGoogleAuth(userId, code);
    
    return response.success(res, {
      enabled: true,
      method: 'google',
      recovery_codes: recoveryCodes,
      message: 'Save these recovery codes in a safe place. Each can only be used once.'
    }, 'Google Authenticator enabled successfully');
    
  } catch (error) {
    console.error('Verify Google Auth error:', error);
    return response.error(res, error.message || 'Verification failed');
  }
};

/**
 * POST /api/2fa/enable-email
 * Enable email-based 2FA
 */
export const enableEmailAuth = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if already enabled
    const status = await twoFactorService.get2FAStatus(userId);
    if (status.enabled) {
      return response.error(res, '2FA is already enabled. Disable it first to change methods.');
    }
    
    // Enable email 2FA
    await twoFactorService.enableEmail2FA(userId);
    
    return response.success(res, {
      enabled: true,
      method: 'email'
    }, 'Email-based 2FA enabled successfully. A code will be sent to your email during login.');
    
  } catch (error) {
    console.error('Enable Email Auth error:', error);
    return response.serverError(res, 'Failed to enable email 2FA');
  }
};

/**
 * POST /api/2fa/verify-email
 * Verify email 2FA code (for testing/confirming setup)
 */
export const verifyEmailAuth = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;
    
    await twoFactorService.verifyEmail2FACode(userId, code);
    
    return response.success(res, {
      verified: true
    }, 'Email 2FA code verified');
    
  } catch (error) {
    console.error('Verify Email Auth error:', error);
    return response.error(res, error.message || 'Verification failed');
  }
};

/**
 * POST /api/2fa/disable
 * Disable 2FA
 */
export const disable2FA = async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.id;
    const email = req.user.email;
    const supabaseAdmin = getSupabaseAdmin();
    
    if (!password) {
      return response.error(res, 'Password is required to disable 2FA');
    }
    
    // Verify password by attempting to sign in
    const { error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      return response.error(res, 'Invalid password');
    }
    
    // Disable 2FA
    await twoFactorService.disable2FA(userId);
    
    return response.success(res, {
      enabled: false,
      method: null
    }, '2FA disabled successfully');
    
  } catch (error) {
    console.error('Disable 2FA error:', error);
    return response.serverError(res, 'Failed to disable 2FA');
  }
};

/**
 * GET /api/2fa/status
 * Check 2FA status
 */
export const get2FAStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const status = await twoFactorService.get2FAStatus(userId);
    
    return response.success(res, status);
    
  } catch (error) {
    console.error('Get 2FA status error:', error);
    return response.serverError(res, 'Failed to get 2FA status');
  }
};

/**
 * POST /api/2fa/send-code
 * Send email 2FA code (for testing)
 */
export const sendEmail2FACode = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if email 2FA is enabled
    const status = await twoFactorService.get2FAStatus(userId);
    if (!status.enabled || status.method !== 'email') {
      return response.error(res, 'Email 2FA is not enabled');
    }
    
    const code = await twoFactorService.generateEmail2FACode(userId);
    
    // TODO: Send email with code
    console.log(`2FA Code for ${req.user.email}: ${code}`);
    
    return response.success(res, null, '2FA code sent to your email');
    
  } catch (error) {
    console.error('Send 2FA code error:', error);
    return response.serverError(res, 'Failed to send 2FA code');
  }
};

/**
 * POST /api/2fa/verify-recovery
 * Verify and use a recovery code
 */
export const verifyRecoveryCode = async (req, res) => {
  try {
    const { code, user_id, temp_token } = req.body;
    
    if (!code || !user_id || !temp_token) {
      return response.error(res, 'Recovery code, user ID, and temp token are required');
    }
    
    // Verify temp token
    await twoFactorService.verify2FALoginToken(user_id, temp_token);
    
    // Verify recovery code
    const result = await twoFactorService.verifyRecoveryCode(user_id, code);
    
    return response.success(res, {
      verified: true,
      remaining_codes: result.remainingCodes,
      warning: result.remainingCodes < 3 
        ? `Only ${result.remainingCodes} recovery codes remaining. Consider generating new ones.`
        : null
    }, 'Recovery code verified');
    
  } catch (error) {
    console.error('Verify recovery code error:', error);
    return response.error(res, error.message || 'Invalid recovery code');
  }
};
