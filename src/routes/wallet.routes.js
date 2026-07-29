import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import checkEmailVerified from '../middleware/checkEmailVerified.js';
import { apiLimiter, paymentLimiter } from '../middleware/rateLimiter.js';
import {
  getWalletBalance,
  getLedger,
  getFundingQuote,
  initFunding
} from '../controllers/wallet/wallet.controller.js';

const router = express.Router();

// Feature flag — wallet is additive and ships dark until WALLET_ENABLED=true.
const requireWalletEnabled = (req, res, next) => {
  if (process.env.WALLET_ENABLED !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
};

router.use(requireWalletEnabled);

router.get('/wallet', authenticate, apiLimiter, getWalletBalance);
router.get('/wallet/ledger', authenticate, apiLimiter, getLedger);
router.get('/wallet/fund/quote', authenticate, apiLimiter, getFundingQuote);
router.post('/wallet/fund', authenticate, checkEmailVerified, paymentLimiter, initFunding);

export default router;
