import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { getQuote, purchase, getPolicy } from '../controllers/insurance.controller.js';
import { isConfigured } from '../services/insurance/curacel.service.js';

const router = express.Router();

// Feature flag, same approach as wallet.routes.js — insurance is additive and
// ships dark until INSURANCE_ENABLED=true and a Curacel key is present.
//
// Scoped to /insurance* rather than a blanket router.use(): a bare use() would
// intercept every later /api mount and 404 them whenever the flag is off.
const requireInsuranceEnabled = (req, res, next) => {
  if (process.env.INSURANCE_ENABLED !== 'true' || !isConfigured()) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return next();
};

router.post('/insurance/quote', requireInsuranceEnabled, authenticate, apiLimiter, getQuote);
router.post('/insurance/purchase', requireInsuranceEnabled, authenticate, apiLimiter, purchase);
router.get('/insurance/policy/:carId', requireInsuranceEnabled, authenticate, apiLimiter, getPolicy);

export default router;
