import jwt from 'jsonwebtoken';
import { getSupabaseAdmin } from '../config/supabase.js';
import { unauthorized, forbidden } from '../utils/responses.js';

/**
 * ADMIN AUTHENTICATION MIDDLEWARE
 *
 * Accepts two token types:
 *  1. Backend JWT  – signed with JWT_SECRET, payload: { is_admin: true, type: 'admin' }
 *     (issued by POST /api/admin/auth/verify-otp)
 *
 *  2. Supabase token – issued directly by Supabase Auth (frontend OTP login).
 *     We verify it via supabaseAdmin.auth.getUser() and check profiles.is_admin.
 *
 * Both paths attach req.admin = { id, email, is_admin: true }
 */
export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized(res, 'No admin token provided');
    }

    const token = authHeader.split(' ')[1];

    // ── Path 1: Try our backend JWT first (fast, no DB call) ─────────────────
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.is_admin && decoded.type === 'admin') {
          req.admin = { id: decoded.id, email: decoded.email, is_admin: true };
          return next();
        }
      } catch (jwtErr) {
        // Not our JWT — fall through to Supabase verification
      }
    }

    // ── Path 2: Supabase token (frontend admin login stores session.access_token) ──
    const supabaseAdmin = getSupabaseAdmin();

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return unauthorized(res, 'Invalid or expired admin token');
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_admin, is_suspended')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return unauthorized(res, 'Admin profile not found');
    }

    if (!profile.is_admin) {
      return forbidden(res, 'Admin access required');
    }

    if (profile.is_suspended) {
      return forbidden(res, 'Your account has been suspended');
    }

    req.admin = { id: user.id, email: user.email, is_admin: true };
    return next();

  } catch (error) {
    console.error('[Admin Auth Middleware] Error:', error);
    return unauthorized(res, 'Authentication failed');
  }
};

export default authenticateAdmin;
