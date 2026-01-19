import rateLimit from 'express-rate-limit';

const createLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { success: false, message },
  standardHeaders: true,
  legacyHeaders: false
});

export const apiLimiter = createLimiter(15 * 60 * 1000, 100, 'Too many requests');
export const authLimiter = createLimiter(15 * 60 * 1000, 10, 'Too many authentication attempts');
export const otpLimiter = createLimiter(15 * 60 * 1000, 5, 'Too many OTP requests');
export const passwordResetLimiter = createLimiter(60 * 60 * 1000, 3, 'Too many password reset attempts');
export const carRegistrationLimiter = createLimiter(15 * 60 * 1000, 5, 'Too many car registration attempts. Please try again later.');