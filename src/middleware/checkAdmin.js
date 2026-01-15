import { forbidden } from '../utils/responses.js';

export const checkAdmin = (req, res, next) => {
  if (!req.user?.profile) {
    return forbidden(res, 'Authentication required');
  }
  
  if (!req.user.profile.is_admin && req.user.profile.user_type_id !== 1) {
    return forbidden(res, 'Admin access required');
  }
  
  next();
};

export default checkAdmin;
