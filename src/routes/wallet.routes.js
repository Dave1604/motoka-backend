import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import checkEmailVerified from '../middleware/checkEmailVerified.js';
import { apiLimiter, paymentLimiter } from '../middleware/rateLimiter.js';
import {
  getWalletBalance,
  getLedger,
  getFundingQuote,
  initFunding,
  payWithWallet
} from '../controllers/wallet/wallet.controller.js';

const router = express.Router();

// Feature flag — wallet is additive and ships dark until WALLET_ENABLED=true.
// IMPORTANT: scope this to /wallet* only. A blanket router.use() would 404 every
// later /api mount (e.g. /referral) when the flag is off, because Express still
// enters this router for all /api requests.
const requireWalletEnabled = (req, res, next) => {
  if (process.env.WALLET_ENABLED !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
};

router.get('/wallet', requireWalletEnabled, authenticate, apiLimiter, getWalletBalance);
router.get('/wallet/ledger', requireWalletEnabled, authenticate, apiLimiter, getLedger);
router.get('/wallet/fund/quote', requireWalletEnabled, authenticate, apiLimiter, getFundingQuote);
router.post('/wallet/fund', requireWalletEnabled, authenticate, checkEmailVerified, paymentLimiter, initFunding);
router.post('/wallet/pay', requireWalletEnabled, authenticate, checkEmailVerified, paymentLimiter, payWithWallet);

export default router;
