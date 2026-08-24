import rateLimit from 'express-rate-limit';

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

// RFC 1918 private ranges + loopback — never legitimate in X-Forwarded-For from the internet.
// If trust proxy causes req.ip to resolve to one of these, it means the header was spoofed
// (KAGE-002). Fall back to the actual TCP socket address so spoofing cannot bypass rate limits.
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|::ffff:127\.)/;

function resolveRateLimitKey(req) {
  const ip = req.ip || '';
  if (PRIVATE_IP_RE.test(ip)) {
    return req.socket?.remoteAddress || ip;
  }
  return ip;
}

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

  // Mo AI chat — per-user limit to cap OpenAI costs
  MO_CHAT: {
    windowMs: 15 * 60 * 1000,
    max: IS_DEV ? 200 : 20,
    message: 'Too many messages — please wait a moment before continuing'
  },

  // Contact form — keep spam/cost down
  CONTACT: {
    windowMs: 15 * 60 * 1000,
    max: IS_DEV ? 30 : 5,
    message: 'Too many messages, please try again later'
  },
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
    // Use validated IP — ignores spoofed RFC 1918 X-Forwarded-For values (KAGE-002)
    keyGenerator: resolveRateLimitKey,
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
export const contactLimiter = createLimiter(RATE_LIMITS.CONTACT);

// Per-account login limiter — keyed by email address (KAGE-008).
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_DEV ? 100 : 10,
  message: { success: false, message: 'Too many login attempts for this account, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body?.email || '').toLowerCase() || resolveRateLimitKey(req),
  skip: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  },
});

// Per-token 2FA limiter — keyed by user_id from body (KAGE-008).
export const twoFAAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_DEV ? 100 : 5,
  message: { success: false, message: 'Too many 2FA attempts, please log in again' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body?.user_id || req.body?.email || '').toLowerCase() || resolveRateLimitKey(req),
  skip: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  },
});

// Mo chat limiter — keyed by user ID (not IP) since the endpoint requires auth
export const moChatLimiter = rateLimit({
  windowMs: RATE_LIMITS.MO_CHAT.windowMs,
  max: RATE_LIMITS.MO_CHAT.max,
  message: { success: false, message: RATE_LIMITS.MO_CHAT.message },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  skip: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  },
});
