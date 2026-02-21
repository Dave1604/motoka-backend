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

<<<<<<< HEAD
// Get all cars (admin view)
router.get('/cars', authenticate, checkAdmin, admin.listCars);

// Get single car details
router.get('/cars/:slug', authenticate, checkAdmin, admin.getCarDetails);

=======
>>>>>>> 72f1150ea89d58254a08437e86ddf9ffbeacf414
// Suspend user account
router.put('/users/:userId/suspend', authenticate, checkAdmin, suspendUserValidation, validate, admin.suspendUser);

// Activate user account
router.put('/users/:userId/activate', authenticate, checkAdmin, admin.activateUser);
<<<<<<< HEAD

// Delete user account (soft delete)
router.delete('/users/:userId', authenticate, checkAdmin, admin.deleteUser);

// Order management - TODO: Implement in Phase 3
// router.get('/orders/stats', admin.getOrderStats);
// router.get('/orders', admin.listOrders);
// router.get('/orders/:orderId', admin.getOrderDetails);
// router.put('/orders/:orderId/assign', admin.assignOrderHandler);
// router.put('/orders/:orderId/status', admin.updateOrderStatusHandler);
// router.put('/orders/:orderId/complete', admin.completeOrderHandler);
=======
>>>>>>> 72f1150ea89d58254a08437e86ddf9ffbeacf414

export default router;
