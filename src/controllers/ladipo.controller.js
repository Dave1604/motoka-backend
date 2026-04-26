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
  getCompatibility,
  upsertCompatibilityEntries,
  deleteCompatibilityEntry,
} from '../services/ladipo/ladipo.service.js';
import { logError } from '../utils/logger.js';
import {
  ladipoAddToCartBodySchema,
  ladipoCartItemIdParamSchema,
  ladipoCreateOrderBodySchema,
  ladipoOrderNumberParamSchema,
  ladipoPayOrderBodySchema,
  ladipoUpdateCartItemBodySchema,
  ladipoVerifyPaymentBodySchema,
} from '../validators/ladipo.validation.js';

function invalidInput(res, zodError) {
  return res.status(400).json({
    success: false,
    message: 'Invalid input',
    issues: zodError.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

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
    const { page, limit, q, category_slug, make, model, year } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const result = await getParts({
      page: parsedPage,
      limit: parsedLimit,
      q,
      category_slug,
      make,
      model,
      year,
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

// GET /ladipo/parts/:id/compatibility
export const handleGetCompatibility = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getCompatibility(id);
    return res.json({ success: true, data });
  } catch (error) {
    logError('[Ladipo] handleGetCompatibility', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /ladipo/parts/:id/compatibility
export const handleUpsertCompatibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { entries = [] } = req.body;
    const data = await upsertCompatibilityEntries(id, entries);
    return res.json({ success: true, data });
  } catch (error) {
    logError('[Ladipo] handleUpsertCompatibility', error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /ladipo/compatibility/:entryId
export const handleDeleteCompatibilityEntry = async (req, res) => {
  try {
    const { entryId } = req.params;
    const data = await deleteCompatibilityEntry(entryId);
    return res.json({ success: true, data });
  } catch (error) {
    logError('[Ladipo] handleDeleteCompatibilityEntry', error);
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
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
    const parsed = ladipoAddToCartBodySchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const userId = req.user.id;
    const { product_id, quantity } = parsed.data;
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
    const paramsParsed = ladipoCartItemIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) return invalidInput(res, paramsParsed.error);

    const bodyParsed = ladipoUpdateCartItemBodySchema.safeParse(req.body);
    if (!bodyParsed.success) return invalidInput(res, bodyParsed.error);

    const userId = req.user.id;
    const { id } = paramsParsed.data;
    const { quantity } = bodyParsed.data;
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
    const paramsParsed = ladipoCartItemIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) return invalidInput(res, paramsParsed.error);

    const userId = req.user.id;
    const { id } = paramsParsed.data;
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
    const parsed = ladipoCreateOrderBodySchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const userId = req.user.id;
    const { items, delivery } = parsed.data;

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
    const paramsParsed = ladipoOrderNumberParamSchema.safeParse(req.params);
    if (!paramsParsed.success) return invalidInput(res, paramsParsed.error);

    const bodyParsed = ladipoPayOrderBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return invalidInput(res, bodyParsed.error);

    const userId = req.user.id;
    const userEmail = req.user.email;
    const { orderNumber } = paramsParsed.data;
    const { payment_gateway } = bodyParsed.data;
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
    const parsed = ladipoVerifyPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const userId = req.user.id;
    const { reference } = parsed.data;

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
    const paramsParsed = ladipoOrderNumberParamSchema.safeParse(req.params);
    if (!paramsParsed.success) return invalidInput(res, paramsParsed.error);

    const userId = req.user.id;
    const { orderNumber } = paramsParsed.data;
    const order = await getOrderByNumber({ orderNumber, userId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, data: order });
  } catch (error) {
    logError('[Ladipo] handleGetOrder', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
