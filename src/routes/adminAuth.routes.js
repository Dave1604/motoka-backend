import { Router } from 'express';
import * as adminAuth from '../controllers/adminAuth.controller.js';
import { authLimiter, otpLimiter } from '../middleware/rateLimiter.js';
import { emailValidation, otpValidation, validate } from '../utils/validators.js';

const router = Router();

/**
 * ADMIN AUTHENTICATION ROUTES
 * 
 * These routes handle admin login via OTP email verification.
 * All routes are public but include rate limiting and validation.
 * 
 * Flow:
 * 1. POST /send-otp - Send 6-digit OTP to admin email
 * 2. POST /verify-otp - Verify OTP and receive JWT token
 * 
 * Mounted at: /api/admin
 * Full paths: /api/admin/send-otp, /api/admin/verify-otp
 */

// Send OTP to admin email
router.post('/send-otp', 
  otpLimiter,              // Rate limit: 5 requests per 15 minutes
  emailValidation,          // Validate email format
  validate,                 // Process validation errors
  adminAuth.adminSendOTP
);

// Verify OTP and return JWT token
router.post('/verify-otp', 
  authLimiter,             // Rate limit: 10 requests per 15 minutes
  otpValidation,           // Validate email and OTP
  validate,                // Process validation errors
  adminAuth.adminVerifyOTP
);

export default router;
