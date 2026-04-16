import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { checkAdmin } from '../middleware/checkAdmin.js';
import { authenticateAdmin } from '../middleware/authenticateAdmin.js';
import { handleDocumentUpload, handleLadipoProductImageUpload } from '../middleware/fileUpload.js';
import { suspendUserValidation, validate } from '../utils/validators.js';
import {
  listLadipoOrders,
  getLadipoOrderDetails,
  getLadipoAdminCapabilities,
  updateLadipoOrderStatus,
  updateLadipoOrderAssignee,
  updateLadipoOrderWorkflow,
  listLadipoProducts,
  createLadipoProduct,
  updateLadipoProduct,
  deleteLadipoProduct,
} from '../controllers/adminLadipo.controller.js';

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
// search must be registered before /:userId to avoid 'search' being captured as a userId param
router.get('/users/search', authenticateAdmin, admin.searchUsers);
router.get('/users/:userId', authenticate, checkAdmin, admin.getUser);
router.get('/users/:userId/cars', authenticateAdmin, admin.getUserCars);
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

// ── Ladipo marketplace management (authenticateAdmin) ────────────────────────
router.get('/ladipo/capabilities', authenticateAdmin, getLadipoAdminCapabilities);
router.get('/ladipo/orders', authenticateAdmin, listLadipoOrders);
router.get('/ladipo/orders/:orderNumber', authenticateAdmin, getLadipoOrderDetails);
router.put('/ladipo/orders/:orderNumber/status', authenticateAdmin, updateLadipoOrderStatus);
router.put('/ladipo/orders/:orderNumber/assignee', authenticateAdmin, updateLadipoOrderAssignee);
router.put('/ladipo/orders/:orderNumber/workflow', authenticateAdmin, updateLadipoOrderWorkflow);
router.get('/ladipo/products', authenticateAdmin, listLadipoProducts);
router.post('/ladipo/products', authenticateAdmin, handleLadipoProductImageUpload, createLadipoProduct);
router.put('/ladipo/products/:productId', authenticateAdmin, handleLadipoProductImageUpload, updateLadipoProduct);
router.delete('/ladipo/products/:productId', authenticateAdmin, deleteLadipoProduct);

// ── Transaction management (authenticateAdmin) ────────────────────────────────
router.get('/transactions/failed', authenticateAdmin, admin.getFailedTransactions);
router.get('/transactions', authenticateAdmin, admin.listTransactions);
router.get('/transactions/:reference', authenticateAdmin, admin.getTransactionDetails);

// ── Document management (authenticateAdmin) ────────────────────────────────────
router.get('/documents', authenticateAdmin, admin.listDocuments);
router.get('/documents/:id/download', authenticateAdmin, admin.downloadDocument);
router.get('/documents/:id', authenticateAdmin, admin.getDocumentDetails);
router.post('/documents/upload', authenticateAdmin, handleDocumentUpload, admin.adminUploadDocument);
router.put('/documents/:id/approve', authenticateAdmin, admin.approveDocument);
router.put('/documents/:id/reject', authenticateAdmin, admin.rejectDocument);

// ── Manual payment processing ────────────────────────────────────────────────
router.put('/transactions/:reference/mark-paid', authenticateAdmin, admin.markTransactionPaid);
router.put('/transactions/:reference/mark-failed', authenticateAdmin, admin.markTransactionFailed);

// ── WhatsApp broadcast ────────────────────────────────────────────────────────
// ?dry_run=true previews count without sending
router.post('/notifications/add-car-reminder', authenticateAdmin, admin.broadcastAddCarReminder);

// ── Guest orders ─────────────────────────────────────────────────────────────
// guest-orders must be registered before /:orderId to avoid capture conflicts
router.get('/guest-orders', authenticateAdmin, admin.listGuestOrders);
router.get('/guest-orders/:orderId', authenticateAdmin, admin.getGuestOrderDetails);

// ── Driver license applications ───────────────────────────────────────────────
router.get('/driver-license-applications', authenticateAdmin, admin.listDriverLicenseApplications);
router.get('/driver-license-applications/:id', authenticateAdmin, admin.getDriverLicenseApplicationDetails);
router.patch('/driver-license-applications/:id/status', authenticateAdmin, admin.updateDriverLicenseApplicationStatus);

export default router;
