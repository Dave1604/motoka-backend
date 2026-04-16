import {
  getCategories,
  getParts,
  getPartBySlug,
  getCartItems,
  addCartItem,
  updateCartItemQuantity,
  removeCartItem,
  createOrder,
  payOrder,
  verifyAndFulfillOrder,
  getUserOrders,
  getOrderByNumber,
} from '../services/ladipo/ladipo.service.js';
import { logError } from '../utils/logger.js';

// GET /ladipo/categories
export const handleGetCategories = async (req, res) => {
  try {
    const data = await getCategories();
    return res.json({ success: true, data });
  } catch (error) {
    logError('[Ladipo] handleGetCategories', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /ladipo/parts
export const handleGetParts = async (req, res) => {
  try {
    const { page, limit, q, category_slug } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const result = await getParts({
      page: parsedPage,
      limit: parsedLimit,
      q,
      category_slug,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    logError('[Ladipo] handleGetParts', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /ladipo/parts/:slug
export const handleGetPartBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const part = await getPartBySlug(slug);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found' });
    return res.json({ success: true, data: part });
  } catch (error) {
    logError('[Ladipo] handleGetPartBySlug', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /ladipo/cart
export const handleGetCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await getCartItems(userId);
    return res.json({ success: true, data: cart });
  } catch (error) {
    logError('[Ladipo] handleGetCart', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /ladipo/cart
export const handleAddToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, quantity } = req.body;
    const cartItem = await addCartItem({ userId, product_id, quantity });
    return res.status(201).json({ success: true, data: cartItem });
  } catch (error) {
    logError('[Ladipo] handleAddToCart', error);
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// PATCH /ladipo/cart/:id
export const handleUpdateCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { quantity } = req.body;
    const cartItem = await updateCartItemQuantity({ userId, cartItemId: id, quantity });
    return res.json({ success: true, data: cartItem });
  } catch (error) {
    logError('[Ladipo] handleUpdateCartItem', error);
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// DELETE /ladipo/cart/:id
export const handleDeleteCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    await removeCartItem({ userId, cartItemId: id });
    return res.json({ success: true, message: 'Cart item removed' });
  } catch (error) {
    logError('[Ladipo] handleDeleteCartItem', error);
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// POST /ladipo/orders
export const handleCreateOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items, delivery } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array is required' });
    }

    const order = await createOrder({ userId, items, delivery });
    return res.status(201).json({ success: true, data: order });
  } catch (error) {
    logError('[Ladipo] handleCreateOrder', error);
    const status = error.message.includes('not found') ? 404
      : error.message.includes('Insufficient') ? 409
        : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// POST /ladipo/orders/:orderNumber/pay
export const handlePayOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { orderNumber } = req.params;
    const { payment_gateway = 'paystack' } = req.body;
    const result = await payOrder({ orderNumber, userId, userEmail, payment_gateway });
    return res.json({ success: true, data: result });
  } catch (error) {
    logError('[Ladipo] handlePayOrder', error);
    const status = error.message.includes('not found') ? 404
      : error.message.includes('already paid') ? 409
        : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// POST /ladipo/orders/verify-payment
export const handleVerifyPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ success: false, message: 'reference is required' });

    const order = await verifyAndFulfillOrder(reference, userId);
    if (!order) return res.status(400).json({ success: false, message: 'Payment verification failed' });

    return res.json({ success: true, data: order });
  } catch (error) {
    logError('[Ladipo] handleVerifyPayment', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// GET /ladipo/orders
export const handleGetUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await getUserOrders(userId);
    return res.json({ success: true, data: orders });
  } catch (error) {
    logError('[Ladipo] handleGetUserOrders', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /ladipo/orders/:orderNumber
export const handleGetOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderNumber } = req.params;
    const order = await getOrderByNumber({ orderNumber, userId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, data: order });
  } catch (error) {
    logError('[Ladipo] handleGetOrder', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
