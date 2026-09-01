import { Router } from 'express';
import multer from 'multer';
import * as admin from '../controllers/admin.controller.js';
import * as walletAdmin from '../controllers/wallet/walletAdmin.controller.js';
import * as renewals from '../controllers/adminRenewals.controller.js';
import { adminCreateShipmentHandler, adminTrackShipmentHandler } from '../controllers/delivery.controller.js';

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
  getLadipoProductFilters,
  listLadipoProducts,
  createLadipoProduct,
  updateLadipoProduct,
  deleteLadipoProduct,
  listLadipoCategories,
  updateLadipoCategoryImage,
} from '../controllers/adminLadipo.controller.js';

// Multer for CSV uploads — memory storage, 5 MB cap, CSV only
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

const router = Router();

/**
     * ADMIN ROUTES
 *
 * Auth: every route uses `authenticateAdmin`, which accepts BOTH admin token
 * types — the backend JWT from POST /api/admin/auth/verify-otp, and the
 * Supabase access token the admin dashboard stores after OTP login.
 *
 * Previously a subset of routes used `authenticate + checkAdmin`, which only
 * understands Supabase tokens. That made Users, Cars and the payment-monitoring
 * endpoints 401 for anyone holding a valid backend admin JWT, even though the
 * rest of the admin API accepted it.
 *
 * Mounted at: /api/admin
 */

// ── User management ──────────────────────────────────────────────────────────
router.post('/users', authenticateAdmin, admin.adminCreateUser);
router.get('/users', authenticateAdmin, admin.listUsers);
// search must be registered before /:userId to avoid 'search' being captured as a userId param
router.get('/users/search', authenticateAdmin, admin.searchUsers);
router.get('/users/:userId', authenticateAdmin, admin.getUser);
router.get('/users/:userId/cars', authenticateAdmin, admin.getUserCars);
router.put('/users/:userId/suspend', authenticateAdmin, suspendUserValidation, validate, admin.suspendUser);
router.put('/users/:userId/activate', authenticateAdmin, admin.activateUser);
router.delete('/users/:userId', authenticateAdmin, admin.deleteUser);

// ── Car management ────────────────────────────────────────────────────────────
// bulk-import must be registered BEFORE /:slug to avoid route capture conflicts
router.post('/cars/bulk-import', authenticateAdmin, csvUpload.single('file'), admin.adminBulkImportCars);
router.post('/cars', authenticateAdmin, admin.adminAddCar);
router.get('/cars', authenticateAdmin, admin.listCars);
router.get('/cars/:slug', authenticateAdmin, admin.getCarDetails);
router.put('/cars/:slug', authenticateAdmin, admin.adminUpdateCar);
router.delete('/cars/:slug', authenticateAdmin, admin.adminDeleteCar);

// ── Payment system monitoring ─────────────────────────────────────────────────
router.get('/metrics/payments', authenticateAdmin, admin.getPaymentMetrics);
router.get('/gateways/health', authenticateAdmin, admin.getGatewayHealth);

// ── Dashboard (authenticateAdmin) ────────────────────────────────────────────
router.get('/dashboard/stats', authenticateAdmin, admin.getDashboardStats);
router.get('/recent-orders', authenticateAdmin, admin.getRecentOrders);
router.get('/recent-transactions', authenticateAdmin, admin.getRecentTransactions);
// Polled by the admin tab's new-activity ping; deliberately light.
router.get('/activity/since', authenticateAdmin, admin.getActivitySince);

// ── Order management (authenticateAdmin) ─────────────────────────────────────
router.get('/orders', authenticateAdmin, admin.listOrders);
router.post('/shipments', authenticateAdmin, adminCreateShipmentHandler);
router.get('/orders/:orderNumber/shipment', authenticateAdmin, adminTrackShipmentHandler);
router.get('/orders/:orderNumber', authenticateAdmin, admin.getOrderDetails);
router.put('/orders/:orderNumber/status', authenticateAdmin, admin.updateOrderStatus);
// Undo an accidental cancellation — returns the order to pending so it can be completed
router.post('/orders/:orderNumber/reopen', authenticateAdmin, admin.reopenOrder);

// ── Ladipo marketplace management (authenticateAdmin) ────────────────────────
router.get('/ladipo/capabilities', authenticateAdmin, getLadipoAdminCapabilities);
router.get('/ladipo/orders', authenticateAdmin, listLadipoOrders);
router.get('/ladipo/orders/:orderNumber', authenticateAdmin, getLadipoOrderDetails);
router.put('/ladipo/orders/:orderNumber/status', authenticateAdmin, updateLadipoOrderStatus);
router.put('/ladipo/orders/:orderNumber/assignee', authenticateAdmin, updateLadipoOrderAssignee);
router.put('/ladipo/orders/:orderNumber/workflow', authenticateAdmin, updateLadipoOrderWorkflow);
router.get('/ladipo/products/filters', authenticateAdmin, getLadipoProductFilters);
router.get('/ladipo/products', authenticateAdmin, listLadipoProducts);
router.post('/ladipo/products', authenticateAdmin, handleLadipoProductImageUpload, createLadipoProduct);
router.put('/ladipo/products/:productId', authenticateAdmin, handleLadipoProductImageUpload, updateLadipoProduct);
router.delete('/ladipo/products/:productId', authenticateAdmin, deleteLadipoProduct);
router.get('/ladipo/categories', authenticateAdmin, listLadipoCategories);
router.patch('/ladipo/categories/:id/image', authenticateAdmin, handleLadipoProductImageUpload, updateLadipoCategoryImage);

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
// ?dry_run=true previews counts | ?days=7 targets a single window
router.post('/notifications/expiry-reminders', authenticateAdmin, admin.triggerExpiryReminders);

// ── Guest orders ─────────────────────────────────────────────────────────────
// guest-orders must be registered before /:orderId to avoid capture conflicts
router.get('/guest-orders', authenticateAdmin, admin.listGuestOrders);
router.get('/guest-orders/:orderId', authenticateAdmin, admin.getGuestOrderDetails);

// ── Driver license applications ───────────────────────────────────────────────
router.get('/driver-license-applications', authenticateAdmin, admin.listDriverLicenseApplications);
router.get('/driver-license-applications/:id', authenticateAdmin, admin.getDriverLicenseApplicationDetails);
router.patch('/driver-license-applications/:id/status', authenticateAdmin, admin.updateDriverLicenseApplicationStatus);

// ── Wallets (Phase 3 admin ops) ───────────────────────────────────────────────
router.get('/wallets', authenticateAdmin, walletAdmin.listWallets);
router.get('/wallets/reconciliation', authenticateAdmin, walletAdmin.getReconciliation);
router.get('/wallets/:userId/ledger', authenticateAdmin, walletAdmin.getUserLedger);
router.post('/wallets/:userId/adjust', authenticateAdmin, walletAdmin.adjustWallet);
router.post('/wallets/:userId/status', authenticateAdmin, walletAdmin.updateWalletStatus);

// ── Renewals ─────────────────────────────────────────────────────────────────
// Static paths before /renewals so they are not swallowed by a future /:id
router.get('/renewals/summary', authenticateAdmin, renewals.getRenewalsSummary);
router.get('/renewals/deferred', authenticateAdmin, renewals.listDeferredRenewals);
router.post('/renewals/:carId/channel', authenticateAdmin, renewals.markRenewalChannel);
router.get('/renewals', authenticateAdmin, renewals.listRenewals);

// ── Vehicle document (renewal item) pricing ───────────────────────────────────
router.get('/vehicle-doc-prices', authenticateAdmin, admin.getRenewalItemPrices);
router.put('/vehicle-doc-prices/:itemKey', authenticateAdmin, admin.updateRenewalItemPrice);

export default router;
