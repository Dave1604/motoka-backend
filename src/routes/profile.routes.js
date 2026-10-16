import { Router } from 'express';
import * as profile from '../controllers/profile.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { updateProfileValidation, validate } from '../utils/validators.js';

const router = Router();

router.get('/', authenticate, profile.getProfile);
router.put('/', authenticate, updateProfileValidation, validate, profile.updateProfile);
// Consents carry their own eligibility rules — keep them off the generic
// profile validator so toggling auto-renew never trips a name/phone rule.
router.put('/consents', authenticate, profile.updateConsents);

export default router;
