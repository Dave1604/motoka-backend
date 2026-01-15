import { forbidden } from '../utils/responses.js';

export const checkEmailVerified = (req, res, next) => {
  if (!req.user) {
    return forbidden(res, 'Authentication required');
  }
  
  if (!req.user.email_confirmed_at) {
    return forbidden(res, 'Please verify your email address');
  }
  
  next();
};

export default checkEmailVerified;
