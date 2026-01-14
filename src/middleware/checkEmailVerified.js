import { forbidden } from '../utils/responses.js';

/**
 * Middleware to check if user's email is verified
 * Must be used AFTER authenticate middleware
 */
export const checkEmailVerified = (req, res, next) => {
  if (!req.user) {
    return forbidden(res, 'Authentication required');
  }
  
  // Supabase stores email verification in the auth user object
  if (!req.user.email_confirmed_at) {
    return forbidden(res, 'Please verify your email address');
  }
  
  next();
};

export default checkEmailVerified;

