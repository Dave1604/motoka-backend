import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkAdmin } from '../middleware/checkAdmin.js';
import { suspendUserValidation, validate } from '../utils/validators.js';

const router = Router();

/**
 * ADMIN USER MANAGEMENT ROUTES
 * 
 * All routes require:
 * - Valid Supabase auth token (authenticate middleware)
 * - Admin privileges (checkAdmin middleware)
 * 
 * Mounted at: /api/admin
 */

// List all users with pagination and filtering
router.get('/users', authenticate, checkAdmin, admin.listUsers);

// Get single user details
router.get('/users/:userId', authenticate, checkAdmin, admin.getUser);

// Get all cars (admin view)
router.get('/cars', authenticate, checkAdmin, admin.listCars);

// Get single car details
router.get('/cars/:slug', authenticate, checkAdmin, admin.getCarDetails);

// Suspend user account
router.put('/users/:userId/suspend', authenticate, checkAdmin, suspendUserValidation, validate, admin.suspendUser);

// Activate user account
router.put('/users/:userId/activate', authenticate, checkAdmin, admin.activateUser);

// Delete user account (soft delete)
router.delete('/users/:userId', authenticate, checkAdmin, admin.deleteUser);

export default router;
