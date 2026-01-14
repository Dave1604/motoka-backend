import { forbidden } from '../utils/responses.js';

/**
 * Middleware to check if user is an admin
 * Must be used AFTER authenticate middleware
 */
export const checkAdmin = (req, res, next) => {
  if (!req.user || !req.user.profile) {
    return forbidden(res, 'Authentication required');
  }
  
  const { profile } = req.user;
  
  // Check if user is admin via is_admin flag or user_type_id
  if (!profile.is_admin && profile.user_type_id !== 1) {
    return forbidden(res, 'Admin access required');
  }
  
  next();
};

export default checkAdmin;

