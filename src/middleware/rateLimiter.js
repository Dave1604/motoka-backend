import rateLimit from 'express-rate-limit';
// TODO: Uncomment for Redis support
// import RedisStore from 'rate-limit-redis';
// import { createClient } from 'redis';

/**
 * SCALABILITY: Rate Limiting Configuration
 * 
 * CURRENT: In-memory storage (default express-rate-limit)
 * - Works for single-instance deployments
 * - Each server instance has separate counters
 * - Rate limits can be bypassed by hitting different instances
 * 
 * TODO: Migrate to Redis for production multi-instance deployment
 * 
 * Redis benefits:
 * - Shared state across all server instances
 * - True rate limiting even with load balancers
 * - Persistent across restarts
 * - Can handle millions of requests
 * 
 * Migration steps:
 * 1. Uncomment Redis imports above
 * 2. Initialize Redis client in store configuration below
 * 3. Update createLimiter to use RedisStore
 * 4. Deploy Redis instance (AWS ElastiCache, Redis Cloud, etc.)
 * 5. Set REDIS_URL in environment variables
 * 
 * Example Redis setup:
 * ```
 * const redisClient = createClient({
 *   url: process.env.REDIS_URL,
 *   socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 500) }
 * });
 * await redisClient.connect();
 * 
 * const store = new RedisStore({
 *   client: redisClient,
 *   prefix: 'rl:' // rate limit prefix
 * });
 * ```
 */

/**
 * Rate limit configuration profiles
 * Organized by endpoint sensitivity
 */
const IS_DEV = process.env.NODE_ENV !== 'production';

const RATE_LIMITS = {
  // General API - lenient limits for normal operations
  API: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: IS_DEV ? 2000 : 300,
    message: 'Too many requests from this IP, please try again later'
  },
  
  // Authentication - moderate limits to prevent brute force
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: IS_DEV ? 100 : 10,
    message: 'Too many authentication attempts, please try again later'
  },
  
  // OTP endpoints - strict limits to prevent abuse and costs
  OTP: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: IS_DEV ? 50 : 5,
    message: 'Too many OTP requests, please try again later'
  },
  
  // Password reset - very strict to prevent account enumeration
  PASSWORD_RESET: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: IS_DEV ? 30 : 3,
    message: 'Too many password reset attempts, please try again later'
  },
  
  // Car registration - moderate limits for data entry operations
  CAR_REGISTRATION: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: IS_DEV ? 100 : 5,
    message: 'Too many car registration attempts, please try again later'
  },
  
  // Payment operations - moderate limits to prevent abuse
  PAYMENT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: IS_DEV ? 100 : 20,
    message: 'Too many payment attempts, please try again later'
  },
  
  // Webhook endpoints - higher limits for gateway webhooks
  WEBHOOK: {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: 'Too many webhook requests'
  },

  // Ladipo marketplace — cart mutations (per IP)
  LADIPO_CART: {
    windowMs: 5 * 60 * 1000,
    max: IS_DEV ? 500 : 50,
    message: 'Too many cart requests, please try again later'
  },

  // Ladipo — order create, pay, verify (stricter; abuse / card testing)
  LADIPO_CHECKOUT: {
    windowMs: 15 * 60 * 1000,
    max: IS_DEV ? 200 : 10,
    message: 'Too many checkout or payment requests, please try again later'
  }
};

/**
 * Creates a rate limiter with specified configuration
 * 
 * @param {Object} config - Rate limit configuration
 * @returns {Function} Express middleware
 */
function createLimiter(config) {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: { success: false, message: config.message },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting entirely for local development (localhost)
    skip: (req) => {
      const ip = req.ip || req.connection?.remoteAddress || '';
      return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    },
  });
}

// Export configured limiters
export const apiLimiter = createLimiter(RATE_LIMITS.API);
export const authLimiter = createLimiter(RATE_LIMITS.AUTH);
export const otpLimiter = createLimiter(RATE_LIMITS.OTP);
export const passwordResetLimiter = createLimiter(RATE_LIMITS.PASSWORD_RESET);
export const carRegistrationLimiter = createLimiter(RATE_LIMITS.CAR_REGISTRATION);
export const paymentLimiter = createLimiter(RATE_LIMITS.PAYMENT);
export const webhookLimiter = createLimiter(RATE_LIMITS.WEBHOOK);
export const ladipoCartLimiter = createLimiter(RATE_LIMITS.LADIPO_CART);
export const ladipoCheckoutLimiter = createLimiter(RATE_LIMITS.LADIPO_CHECKOUT);