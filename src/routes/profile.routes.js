import { Router } from 'express';
import * as profile from '../controllers/profile.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { updateProfileValidation, validate } from '../utils/validators.js';

const router = Router();

router.get('/', authenticate, profile.getProfile);
router.put('/', authenticate, updateProfileValidation, validate, profile.updateProfile);

export default router;
