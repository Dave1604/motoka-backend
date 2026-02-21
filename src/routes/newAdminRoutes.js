import { Router } from 'express';
import * as admin from '../controllers/newAdminController.js';
const router = Router();

//Admin login to generate Otp
router.post('/login', admin.adminLoginRequest);

//Admin verify Otp to Login
router.post('/verify-otp', admin.adminVerifyOtp);

router.get('/getAllUsers', admin.getAllUsers)
export default router
