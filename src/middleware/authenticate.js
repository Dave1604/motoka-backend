import { getSupabaseAdmin } from '../config/supabase.js';
import { unauthorized, forbidden } from '../utils/responses.js';

/**
 * Middleware to verify Supabase JWT token
 * Extracts user from Authorization header
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'No token provided');
    }
    
    const token = authHeader.split(' ')[1];
    const supabaseAdmin = getSupabaseAdmin();
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      return unauthorized(res, 'Invalid or expired token');
    }
    
    // Fetch user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (profileError || !profile) {
      return unauthorized(res, 'User profile not found');
    }
    
    // Check if user is suspended
    if (profile.is_suspended) {
      return forbidden(res, 'Your account has been suspended');
    }
    
    // Check if soft deleted
    if (profile.deleted_at) {
      return forbidden(res, 'Your account has been deleted');
    }
    
    // Attach user data to request
    req.user = {
      ...user,
      profile
    };
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return unauthorized(res, 'Authentication failed');
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      req.user = null;
      return next();
    }
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    req.user = profile ? { ...user, profile } : null;
    req.token = token;
    
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

export default authenticate;
