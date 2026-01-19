import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkAdmin } from '../middleware/checkAdmin.js';
import { suspendUserValidation, validate } from '../utils/validators.js';

const router = Router();

router.use(authenticate, checkAdmin);

router.get('/users', admin.listUsers);
router.get('/users/:userId', admin.getUser);
router.put('/users/:userId/suspend', suspendUserValidation, validate, admin.suspendUser);
router.put('/users/:userId/activate', admin.activateUser);

export default router;
