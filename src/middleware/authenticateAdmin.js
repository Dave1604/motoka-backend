import jwt from 'jsonwebtoken';
import { unauthorized, forbidden } from '../utils/responses.js';

/**
 * ADMIN JWT AUTHENTICATION MIDDLEWARE
 * 
 * Validates JWT tokens issued by the admin auth system.
 * This is separate from the regular user authentication.
 * 
 * Token should be in format: "Bearer <token>"
 * Token payload must include: { is_admin: true, type: 'admin' }
 * 
 * Usage:
 * - Apply to admin-only routes that need authentication
 * - Works alongside checkAdmin for existing Supabase-auth admin routes
 */
export const authenticateAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized(res, 'No admin token provided');
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!process.env.JWT_SECRET) {
      console.error('[Admin Auth Middleware] JWT_SECRET not configured');
      return forbidden(res, 'Authentication service misconfigured');
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Validate admin credentials in token
    if (!decoded.is_admin || decoded.type !== 'admin') {
      return forbidden(res, 'Admin access required');
    }
    
    // Attach admin info to request
    req.admin = {
      id: decoded.id,
      email: decoded.email,
      is_admin: true
    };
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return unauthorized(res, 'Admin token has expired');
    }
    
    if (error.name === 'JsonWebTokenError') {
      return unauthorized(res, 'Invalid admin token');
    }
    
    console.error('[Admin Auth Middleware] Error:', error);
    return unauthorized(res, 'Authentication failed');
  }
};

export default authenticateAdmin;
