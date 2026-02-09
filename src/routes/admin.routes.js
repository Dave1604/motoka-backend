import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkAdmin } from '../middleware/checkAdmin.js';
import { suspendUserValidation, validate } from '../utils/validators.js';

const router = Router();

router.use(authenticate, checkAdmin);

// User management
router.get('/users', admin.listUsers);
router.get('/users/:userId', admin.getUser);
router.put('/users/:userId/suspend', suspendUserValidation, validate, admin.suspendUser);
router.put('/users/:userId/activate', admin.activateUser);

// Order management - TODO: Implement in Phase 3
// router.get('/orders/stats', admin.getOrderStats);
// router.get('/orders', admin.listOrders);
// router.get('/orders/:orderId', admin.getOrderDetails);
// router.put('/orders/:orderId/assign', admin.assignOrderHandler);
// router.put('/orders/:orderId/status', admin.updateOrderStatusHandler);
// router.put('/orders/:orderId/complete', admin.completeOrderHandler);

export default router;
