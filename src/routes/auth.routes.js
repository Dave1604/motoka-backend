import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import * as twoFactorController from '../controllers/twoFactor.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { authLimiter, otpLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';
import {
  registerValidation,
  loginValidation,
  emailValidation,
  otpValidation,
  resetPasswordValidation,
  twoFactorCodeValidation,
  validate
} from '../utils/validators.js';

const router = Router();

// ============================================
// PUBLIC AUTHENTICATION ROUTES
// ============================================

/**
 * POST /api/register
 * Register a new user
 */
router.post(
  '/register',
  authLimiter,
  registerValidation,
  validate,
  authController.register
);

/**
 * POST /api/login
 * Login with email/password
 */
router.post(
  '/login',
  authLimiter,
  loginValidation,
  validate,
  authController.login
);

/**
 * POST /api/send-otp
 * Send OTP for password reset
 */
router.post(
  '/send-otp',
  passwordResetLimiter,
  emailValidation,
  validate,
  authController.sendPasswordResetOTP
);

/**
 * POST /api/verify-otp
 * Verify OTP for password reset
 */
router.post(
  '/verify-otp',
  otpLimiter,
  otpValidation,
  validate,
  authController.verifyPasswordResetOTP
);

/**
 * POST /api/reset-password
 * Reset password with token
 */
router.post(
  '/reset-password',
  resetPasswordValidation,
  validate,
  authController.resetPassword
);

/**
 * POST /api/send-login-otp
 * Send OTP for passwordless login
 */
router.post(
  '/send-login-otp',
  otpLimiter,
  emailValidation,
  validate,
  authController.sendLoginOTP
);

/**
 * POST /api/verify-login-otp
 * Verify OTP and login user
 */
router.post(
  '/verify-login-otp',
  authLimiter,
  otpValidation,
  validate,
  authController.verifyLoginOTP
);

// ============================================
// EMAIL VERIFICATION ROUTES
// ============================================

/**
 * POST /api/verify/email-resend
 * Resend email verification
 */
router.post(
  '/verify/email-resend',
  otpLimiter,
  emailValidation,
  validate,
  authController.resendEmailVerification
);

// ============================================
// TWO-FACTOR AUTH - LOGIN VERIFICATION (Public)
// ============================================

/**
 * POST /api/2fa/verify-login
 * Verify 2FA code during login
 */
router.post(
  '/2fa/verify-login',
  authLimiter,
  authController.verify2FALogin
);

/**
 * POST /api/2fa/verify-recovery
 * Use recovery code during login
 */
router.post(
  '/2fa/verify-recovery',
  authLimiter,
  twoFactorController.verifyRecoveryCode
);

// ============================================
// PROTECTED ROUTES (Require Authentication)
// ============================================

/**
 * POST /api/logout
 * Logout user
 */
router.post('/logout', authenticate, authController.logout);

/**
 * POST /api/refresh
 * Refresh access token
 */
router.post('/refresh', authController.refresh);

/**
 * GET /api/me
 * Get current authenticated user
 */
router.get('/me', authenticate, authController.me);

// ============================================
// TWO-FACTOR AUTHENTICATION ROUTES (Protected)
// ============================================

/**
 * GET /api/2fa/status
 * Check 2FA status
 */
router.get(
  '/2fa/status',
  authenticate,
  twoFactorController.get2FAStatus
);

/**
 * POST /api/2fa/enable-google
 * Start Google Authenticator 2FA setup
 */
router.post(
  '/2fa/enable-google',
  authenticate,
  checkEmailVerified,
  twoFactorController.enableGoogleAuth
);

/**
 * POST /api/2fa/verify-google
 * Verify and confirm Google Authenticator setup
 */
router.post(
  '/2fa/verify-google',
  authenticate,
  checkEmailVerified,
  twoFactorCodeValidation,
  validate,
  twoFactorController.verifyGoogleAuth
);

/**
 * POST /api/2fa/enable-email
 * Enable email-based 2FA
 */
router.post(
  '/2fa/enable-email',
  authenticate,
  checkEmailVerified,
  twoFactorController.enableEmailAuth
);

/**
 * POST /api/2fa/verify-email
 * Verify email 2FA code
 */
router.post(
  '/2fa/verify-email',
  authenticate,
  twoFactorCodeValidation,
  validate,
  twoFactorController.verifyEmailAuth
);

/**
 * POST /api/2fa/send-code
 * Send email 2FA code
 */
router.post(
  '/2fa/send-code',
  authenticate,
  otpLimiter,
  twoFactorController.sendEmail2FACode
);

/**
 * POST /api/2fa/disable
 * Disable 2FA
 */
router.post(
  '/2fa/disable',
  authenticate,
  twoFactorController.disable2FA
);

export default router;

