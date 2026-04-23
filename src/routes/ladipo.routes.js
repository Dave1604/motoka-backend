import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authenticateAdmin } from '../middleware/authenticateAdmin.js';
import {
  handleGetCategories,
  handleGetParts,
  handleGetPartBySlug,
  handleGetCompatibility,
  handleUpsertCompatibility,
  handleDeleteCompatibilityEntry,
  handleGetCart,
  handleAddToCart,
  handleUpdateCartItem,
  handleDeleteCartItem,
  handleCreateOrder,
  handlePayOrder,
  handleVerifyPayment,
  handleGetUserOrders,
  handleGetOrder,
} from '../controllers/ladipo.controller.js';

const router = express.Router();

// ─── Public: browsing ────────────────────────────────────────────────────────
router.get('/ladipo/categories', handleGetCategories);
router.get('/ladipo/parts', handleGetParts);
router.get('/ladipo/parts/:slug', handleGetPartBySlug);
router.get('/ladipo/parts/:id/compatibility', handleGetCompatibility);
router.post('/ladipo/parts/:id/compatibility', authenticateAdmin, handleUpsertCompatibility);
router.delete('/ladipo/compatibility/:entryId', authenticateAdmin, handleDeleteCompatibilityEntry);

// ─── Protected: orders ───────────────────────────────────────────────────────
// NOTE: verify-payment must be declared before /:orderNumber to avoid route collision
router.post('/ladipo/orders/verify-payment', authenticate, handleVerifyPayment);

// ─── Protected: cart ─────────────────────────────────────────────────────────
router.get('/ladipo/cart', authenticate, handleGetCart);
router.post('/ladipo/cart', authenticate, handleAddToCart);
router.patch('/ladipo/cart/:id', authenticate, handleUpdateCartItem);
router.delete('/ladipo/cart/:id', authenticate, handleDeleteCartItem);

// ─── Protected: orders ───────────────────────────────────────────────────────
router.post('/ladipo/orders', authenticate, handleCreateOrder);
router.get('/ladipo/orders', authenticate, handleGetUserOrders);
router.get('/ladipo/orders/:orderNumber', authenticate, handleGetOrder);
router.post('/ladipo/orders/:orderNumber/pay', authenticate, handlePayOrder);

export default router;
