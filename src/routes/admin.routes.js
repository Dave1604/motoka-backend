import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkAdmin } from '../middleware/checkAdmin.js';
import { suspendUserValidation, validate } from '../utils/validators.js';

const router = Router();

router.get('/users', authenticate, checkAdmin, admin.listUsers);
router.get('/users/:userId', authenticate, checkAdmin, admin.getUser);
router.get('/cars', authenticate, checkAdmin, admin.listCars);
router.get('/cars/:slug', authenticate, checkAdmin, admin.getCarDetails);
router.put('/users/:userId/suspend', authenticate, checkAdmin, suspendUserValidation, validate, admin.suspendUser);
router.put('/users/:userId/activate', authenticate, checkAdmin, admin.activateUser);
router.delete('/users/:userId', authenticate, checkAdmin, admin.deleteUser);
router.get('/metrics/payments', authenticate, checkAdmin, admin.getPaymentMetrics);
router.get('/gateways/health', authenticate, checkAdmin, admin.getGatewayHealth);

// Order management - TODO: Implement in Phase 3
// router.get('/orders/stats', admin.getOrderStats);
// router.get('/orders', admin.listOrders);
// router.get('/orders/:orderId', admin.getOrderDetails);
// router.put('/orders/:orderId/assign', admin.assignOrderHandler);
// router.put('/orders/:orderId/status', admin.updateOrderStatusHandler);
// router.put('/orders/:orderId/complete', admin.completeOrderHandler);

export default router;
