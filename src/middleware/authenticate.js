import { getSupabaseAdmin } from '../config/supabase.js';
import { unauthorized, forbidden } from '../utils/responses.js';

/**
 * SCALABILITY: In-memory profile cache
 * Reduces DB calls from 2 per request to 1 (or 0 if cached)
 * 
 * TODO: Replace with Redis for production multi-instance deployment
 * Redis benefits:
 * - Shared across all server instances
 * - Persistent across restarts
 * - Better eviction policies
 * - Pub/sub for cache invalidation
 * 
 * Current implementation: Simple Map with TTL
 * - Cache key: userId
 * - TTL: 10 minutes (600000ms)
 * - Auto-cleanup on access
 */
const profileCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedProfile(userId) {
  const cached = profileCache.get(userId);
  if (!cached) return null;
  
  // Check if expired
  if (Date.now() > cached.expiresAt) {
    profileCache.delete(userId);
    return null;
  }
  
  return cached.profile;
}

function setCachedProfile(userId, profile) {
  // Limit cache size to prevent memory exhaustion
  // TODO: Replace with LRU cache or Redis
  if (profileCache.size > 10000) {
    // Remove oldest 20% when limit reached
    const entries = Array.from(profileCache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    entries.slice(0, 2000).forEach(([key]) => profileCache.delete(key));
  }
  
  profileCache.set(userId, {
    profile,
    expiresAt: Date.now() + CACHE_TTL
  });
}

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized(res, 'No token provided');
    }
    
    const token = authHeader.split(' ')[1];
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      return unauthorized(res, 'Invalid or expired token');
    }
    
    // SCALABILITY: Check cache first to avoid DB query
    let profile = getCachedProfile(user.id);
    
    if (!profile) {
      // Cache miss - fetch from DB
      const { data: fetchedProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (!fetchedProfile) {
        return unauthorized(res, 'User profile not found');
      }
      
      profile = fetchedProfile;
      setCachedProfile(user.id, profile);
    }
    
    if (profile.is_suspended) {
      return forbidden(res, 'Your account has been suspended');
    }
    
    if (profile.deleted_at) {
      return forbidden(res, 'Your account has been deleted');
    }
    
    req.user = { ...user, profile };
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return unauthorized(res, 'Authentication failed');
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    
    if (!user) {
      req.user = null;
      return next();
    }
    
    // SCALABILITY: Use cache for optional auth too
    let profile = getCachedProfile(user.id);
    
    if (!profile) {
      const { data: fetchedProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (fetchedProfile) {
        profile = fetchedProfile;
        setCachedProfile(user.id, profile);
      }
    }
    
    req.user = profile ? { ...user, profile } : null;
    req.token = token;
    
    next();
  } catch {
    req.user = null;
    next();
  }
};

export default authenticate;
