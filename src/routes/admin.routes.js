import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkAdmin } from '../middleware/checkAdmin.js';
import { authenticateAdmin } from '../middleware/authenticateAdmin.js';
import { suspendUserValidation, validate } from '../utils/validators.js';

const router = Router();

/**
 * ADMIN ROUTES
 *
 * Two auth strategies:
 *  - Supabase token routes (legacy): authenticate + checkAdmin
 *  - JWT/Supabase admin token routes (new): authenticateAdmin
 *
 * Mounted at: /api/admin
 */

// ── User management (Supabase-auth based) ────────────────────────────────────
router.get('/users', authenticate, checkAdmin, admin.listUsers);
router.get('/users/:userId', authenticate, checkAdmin, admin.getUser);


// Get all cars (admin view)
router.get('/cars', authenticate, checkAdmin, admin.listCars);

// Get single car details
router.get('/cars/:slug', authenticate, checkAdmin, admin.getCarDetails);


// Suspend user account
router.put('/users/:userId/suspend', authenticate, checkAdmin, suspendUserValidation, validate, admin.suspendUser);
router.put('/users/:userId/activate', authenticate, checkAdmin, admin.activateUser);

// Delete user account (soft delete)
router.delete('/users/:userId', authenticate, checkAdmin, admin.deleteUser);

// Order management - TODO: Implement in Phase 3
// router.get('/orders/stats', admin.getOrderStats);
// router.get('/orders', admin.listOrders);
// router.get('/orders/:orderId', admin.getOrderDetails);
// router.put('/orders/:orderId/assign', admin.assignOrderHandler);
// router.put('/orders/:orderId/status', admin.updateOrderStatusHandler);
// router.put('/orders/:orderId/complete', admin.completeOrderHandler);

export default router;
