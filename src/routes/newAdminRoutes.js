import { Router } from 'express';
import * as admin from '../controllers/newAdminController.js';
const router = Router();

router.post('/login', admin.adminLoginRequest);
router.post('/verify-otp', admin.adminVerifyOtp);

export default router
