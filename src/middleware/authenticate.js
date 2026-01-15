import { getSupabaseAdmin } from '../config/supabase.js';
import { unauthorized, forbidden } from '../utils/responses.js';

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
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (!profile) {
      return unauthorized(res, 'User profile not found');
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
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    req.user = profile ? { ...user, profile } : null;
    req.token = token;
    
    next();
  } catch {
    req.user = null;
    next();
  }
};

export default authenticate;
