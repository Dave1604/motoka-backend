import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import * as twoFactor from '../controllers/twoFactor.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkEmailVerified } from '../middleware/checkEmailVerified.js';
import { authLimiter, otpLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';
import { registerValidation, loginValidation, emailValidation, otpValidation, resetPasswordValidation, twoFactorCodeValidation, validate } from '../utils/validators.js';

const router = Router();

// Public routes
router.post('/register', authLimiter, registerValidation, validate, auth.register);
router.post('/login', authLimiter, loginValidation, validate, auth.login);
router.post('/send-otp', passwordResetLimiter, emailValidation, validate, auth.sendPasswordResetOTP);
router.post('/verify-otp', otpLimiter, otpValidation, validate, auth.verifyPasswordResetOTP);
router.post('/reset-password', resetPasswordValidation, validate, auth.resetPassword);
router.post('/send-login-otp', otpLimiter, emailValidation, validate, auth.sendLoginOTP);
router.post('/verify-login-otp', authLimiter, otpValidation, validate, auth.verifyLoginOTP);
router.post('/verify/email-resend', otpLimiter, emailValidation, validate, auth.resendEmailVerification);
router.post('/refresh', auth.refresh);

// 2FA public routes
router.post('/2fa/verify-login', authLimiter, auth.verify2FALogin);
router.post('/2fa/verify-recovery', authLimiter, twoFactor.verifyRecoveryCode);

// Protected routes
router.post('/logout', authenticate, auth.logout);
router.get('/me', authenticate, auth.me);

// 2FA protected routes
router.get('/2fa/status', authenticate, twoFactor.get2FAStatus);
router.post('/2fa/enable-google', authenticate, checkEmailVerified, twoFactor.enableGoogleAuth);
router.post('/2fa/verify-google', authenticate, checkEmailVerified, twoFactorCodeValidation, validate, twoFactor.verifyGoogleAuth);
router.post('/2fa/enable-email', authenticate, checkEmailVerified, twoFactor.enableEmailAuth);
router.post('/2fa/verify-email', authenticate, twoFactorCodeValidation, validate, twoFactor.verifyEmailAuth);
router.post('/2fa/send-code', authenticate, otpLimiter, twoFactor.sendEmail2FACode);
router.post('/2fa/disable', authenticate, twoFactor.disable2FA);

export default router;
