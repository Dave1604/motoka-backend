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
const RATE_LIMITS = {
  // General API - lenient limits for normal operations
  API: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later'
  },
  
  // Authentication - moderate limits to prevent brute force
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: 'Too many authentication attempts, please try again later'
  },
  
  // OTP endpoints - strict limits to prevent abuse and costs
  // CRITICAL: OTP sends emails which cost money and can be spammed
  OTP: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Too many OTP requests, please try again later'
  },
  
  // Password reset - very strict to prevent account enumeration
  PASSWORD_RESET: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: 'Too many password reset attempts, please try again later'
  },
  
  // Car registration - moderate limits for data entry operations
  CAR_REGISTRATION: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Too many car registration attempts, please try again later'
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
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    
    // TODO: Add Redis store here
    // store: redisStore,
    
    // Skip rate limiting for successful requests if needed
    // skipSuccessfulRequests: false,
    
    // Skip rate limiting for failed requests if needed
    // skipFailedRequests: false,
  });
}

// Export configured limiters
export const apiLimiter = createLimiter(RATE_LIMITS.API);
export const authLimiter = createLimiter(RATE_LIMITS.AUTH);
export const otpLimiter = createLimiter(RATE_LIMITS.OTP);
export const passwordResetLimiter = createLimiter(RATE_LIMITS.PASSWORD_RESET);
export const carRegistrationLimiter = createLimiter(RATE_LIMITS.CAR_REGISTRATION);