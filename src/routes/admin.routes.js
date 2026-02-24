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
router.put('/users/:userId/suspend', authenticate, checkAdmin, suspendUserValidation, validate, admin.suspendUser);
router.put('/users/:userId/activate', authenticate, checkAdmin, admin.activateUser);
router.delete('/users/:userId', authenticate, checkAdmin, admin.deleteUser);

// ── Car management (Supabase-auth based) ─────────────────────────────────────
router.get('/cars', authenticate, checkAdmin, admin.listCars);
router.get('/cars/:slug', authenticate, checkAdmin, admin.getCarDetails);

// ── Payment system monitoring ─────────────────────────────────────────────────
router.get('/metrics/payments', authenticate, checkAdmin, admin.getPaymentMetrics);
router.get('/gateways/health', authenticate, checkAdmin, admin.getGatewayHealth);

// ── Dashboard (authenticateAdmin) ────────────────────────────────────────────
router.get('/dashboard/stats', authenticateAdmin, admin.getDashboardStats);
router.get('/recent-orders', authenticateAdmin, admin.getRecentOrders);
router.get('/recent-transactions', authenticateAdmin, admin.getRecentTransactions);

// ── Order management (authenticateAdmin) ─────────────────────────────────────
router.get('/orders', authenticateAdmin, admin.listOrders);
router.get('/orders/:orderNumber', authenticateAdmin, admin.getOrderDetails);
router.put('/orders/:orderNumber/status', authenticateAdmin, admin.updateOrderStatus);

// ── Transaction management (authenticateAdmin) ────────────────────────────────
router.get('/transactions/failed', authenticateAdmin, admin.getFailedTransactions);
router.get('/transactions', authenticateAdmin, admin.listTransactions);

export default router;
