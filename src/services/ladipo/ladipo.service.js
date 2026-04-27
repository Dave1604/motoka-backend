import { getSupabaseAdmin } from '../../config/supabase.js';
import { initializeTransaction, verifyTransaction } from '../payment/paystack.service.js';
import { initializeTransaction as initMonicredit } from '../payment/monicredit/monicredit.service.js';
import { MonicreditNormalizer } from '../payment/monicredit/monicredit.normalizer.js';
import { MonicreditAdapter } from '../payment/monicredit/index.js';
import { getAllStates, getDeliveryFee } from '../location.service.js';
import { logError, logInfo, logDebug } from '../../utils/logger.js';
import {
  notifyLadipoOrderCreated,
  notifyLadipoPaymentSuccess,
  notifyLadipoPaymentFailed,
} from './ladipoNotifications.service.js';

// ─── Categories ──────────────────────────────────────────────────────────────

export async function getCategories() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_categories')
    .select('id, name, slug, parent_id, sort_order')
    .order('sort_order', { ascending: true });

  if (error) {
    logError('[Ladipo] getCategories failed', error);
    throw new Error('Failed to fetch categories');
  }
  return data;
}

// ─── Parts ───────────────────────────────────────────────────────────────────

export async function getParts({ page = 1, limit = 20, q, category_slug, make, model, year } = {}) {
  const supabase = getSupabaseAdmin();
  const offset = (page - 1) * limit;

  let query = supabase
    .from('ladipo_parts')
    .select(`
      id, slug, name, description, brand, condition, part_type, images, is_active, is_universal,
      category:ladipo_categories(id, name, slug),
      inventory:ladipo_part_inventory(id, price_kobo, stock_qty, seller_label),
      compatibility:ladipo_part_compatibility(id, make, model, year_min, year_max, engine_code, notes)
    `, { count: 'exact' })
    .eq('is_active', true)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (category_slug) {
    const { data: cat, error: catErr } = await supabase
      .from('ladipo_categories')
      .select('id, parent_id')
      .eq('slug', category_slug)
      .single();

    if (catErr || !cat) return { parts: [], total: 0 };

    const categoryIds = [cat.id];

    if (!cat.parent_id) {
      const { data: childCategories, error: childErr } = await supabase
        .from('ladipo_categories')
        .select('id')
        .eq('parent_id', cat.id);

      if (childErr) {
        logError('[Ladipo] getParts child category lookup failed', childErr);
        throw new Error('Failed to fetch parts');
      }

      categoryIds.push(...(childCategories || []).map((child) => child.id));
    }

    query = query.in('category_id', categoryIds);
  }

  const normalizedMake = typeof make === 'string' ? make.trim() : '';
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  const parsedYear = year === undefined || year === null || year === ''
    ? null
    : Number.parseInt(year, 10);

  if (normalizedMake) {
    const { data: compatibilityRows, error: compatibilityErr } = await supabase
      .from('ladipo_part_compatibility')
      .select('part_id, model, year_min, year_max')
      .ilike('make', normalizedMake);

    if (compatibilityErr) {
      logError('[Ladipo] getParts compatibility lookup failed', compatibilityErr);
      throw new Error('Failed to fetch parts');
    }

    const compatibleIds = new Set(
      (compatibilityRows || [])
        .filter((row) => {
          const modelMatches = !normalizedModel
            || !row.model
            || String(row.model).trim().toLowerCase() === normalizedModel.toLowerCase();
          const yearMatches = !Number.isFinite(parsedYear)
            || parsedYear === null
            || ((row.year_min == null || row.year_min <= parsedYear)
              && (row.year_max == null || row.year_max >= parsedYear));
          return modelMatches && yearMatches;
        })
        .map((row) => row.part_id)
        .filter(Boolean)
    );

    const { data: universalRows, error: universalErr } = await supabase
      .from('ladipo_parts')
      .select('id')
      .eq('is_active', true)
      .eq('is_universal', true);

    if (universalErr) {
      logError('[Ladipo] getParts universal lookup failed', universalErr);
      throw new Error('Failed to fetch parts');
    }

    for (const row of universalRows || []) {
      if (row?.id) compatibleIds.add(row.id);
    }

    const allIds = Array.from(compatibleIds);
    if (allIds.length === 0) {
      return { parts: [], total: 0 };
    }

    query = query.in('id', allIds);
  }

  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    const synonymGroups = [
      ['tyre', 'tire'],
      ['brake', 'break pad'],
      ['absorber', 'shock', 'damper'],
      ['battery', 'accumulator'],
      ['filter', 'strainer'],
      ['bearing', 'hub bearing'],
      ['coolant', 'antifreeze'],
      ['lubricant', 'engine oil', 'oil'],
      ['belt', 'drive belt', 'fan belt'],
      ['wiper', 'windscreen wiper', 'blade'],
      ['light', 'headlamp', 'headlight', 'bulb'],
      ['spark plug', 'sparkplug'],
      ['exhaust', 'muffler'],
      ['steering', 'rack', 'power steering'],
      ['alternator', 'dynamo'],
      ['radiator', 'cooling radiator'],
    ];

    const expandedTerms = new Set([term]);
    for (const group of synonymGroups) {
      if (group.some((s) => term.includes(s) || s.includes(term))) {
        for (const synonym of group) expandedTerms.add(synonym);
      }
    }

    const orClauses = [...expandedTerms].flatMap((t) => [
      `name.ilike.%${t}%`,
      `brand.ilike.%${t}%`,
      `description.ilike.%${t}%`,
    ]);
    query = query.or(orClauses.join(','));
  }

  const { data, error, count } = await query;

  if (error) {
    logError('[Ladipo] getParts failed', error);
    throw new Error('Failed to fetch parts');
  }

  // Flatten inventory to primary row and add price/stock to root
  const parts = (data || []).map(flattenPart);
  return { parts, total: count ?? parts.length };
}

export async function getPartBySlug(slug) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_parts')
    .select(`
      id, slug, name, description, brand, condition, part_type, images, specifications, key_features, is_active, is_universal,
      category:ladipo_categories(id, name, slug),
      inventory:ladipo_part_inventory(id, price_kobo, stock_qty, seller_label),
      compatibility:ladipo_part_compatibility(id, make, model, year_min, year_max, engine_code, notes)
    `)
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    logError('[Ladipo] getPartBySlug failed', error);
    throw new Error('Failed to fetch part');
  }

  return flattenPart(data);
}

export async function getCompatibility(partId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_part_compatibility')
    .select('id, part_id, make, model, year_min, year_max, engine_code, notes, created_at')
    .eq('part_id', partId)
    .order('make', { ascending: true })
    .order('model', { ascending: true, nullsFirst: true })
    .order('year_min', { ascending: true, nullsFirst: true });

  if (error) {
    logError('[Ladipo] getCompatibility failed', error);
    throw new Error('Failed to fetch compatibility');
  }

  return data || [];
}

export async function upsertCompatibilityEntries(partId, entries = []) {
  const supabase = getSupabaseAdmin();
  const safeEntries = Array.isArray(entries) ? entries : [];

  const normalizedEntries = safeEntries.map((entry) => {
    const makeValue = String(entry?.make || '').trim();
    if (!makeValue) {
      throw new Error('Each compatibility entry must include make');
    }

    const modelValue = entry?.model ? String(entry.model).trim() : null;
    const yearMinValue = entry?.year_min === '' || entry?.year_min == null
      ? null
      : Number.parseInt(entry.year_min, 10);
    const yearMaxValue = entry?.year_max === '' || entry?.year_max == null
      ? null
      : Number.parseInt(entry.year_max, 10);

    if ((yearMinValue != null && !Number.isInteger(yearMinValue))
      || (yearMaxValue != null && !Number.isInteger(yearMaxValue))) {
      throw new Error('year_min and year_max must be valid integers');
    }
    if (yearMinValue != null && yearMaxValue != null && yearMinValue > yearMaxValue) {
      throw new Error('year_min cannot be greater than year_max');
    }

    return {
      part_id: partId,
      make: makeValue,
      model: modelValue || null,
      year_min: yearMinValue,
      year_max: yearMaxValue,
      engine_code: entry?.engine_code ? String(entry.engine_code).trim() : null,
      notes: entry?.notes ? String(entry.notes).trim() : null,
    };
  });

  const { error: deleteErr } = await supabase
    .from('ladipo_part_compatibility')
    .delete()
    .eq('part_id', partId);

  if (deleteErr) {
    logError('[Ladipo] upsertCompatibilityEntries delete failed', deleteErr);
    throw new Error('Failed to update compatibility');
  }

  if (normalizedEntries.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('ladipo_part_compatibility')
    .insert(normalizedEntries)
    .select('id, part_id, make, model, year_min, year_max, engine_code, notes, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    logError('[Ladipo] upsertCompatibilityEntries insert failed', error);
    throw new Error('Failed to update compatibility');
  }

  return data || [];
}

export async function deleteCompatibilityEntry(entryId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_part_compatibility')
    .delete()
    .eq('id', entryId)
    .select('id, part_id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error('Compatibility entry not found');
    }
    logError('[Ladipo] deleteCompatibilityEntry failed', error);
    throw new Error('Failed to delete compatibility entry');
  }

  return data;
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export async function getCartItems(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_cart_items')
    .select(`
      id, user_id, product_id, quantity, created_at,
      product:ladipo_parts(id, slug, name, images, brand, is_active)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logError('[Ladipo] getCartItems failed', error);
    throw new Error('Failed to fetch cart items');
  }

  return (data || []).map((item) => ({
    ...item,
    product_name: item.product?.name || '',
    product_slug: item.product?.slug || '',
    product_image_url: item.product?.images?.[0] || null,
  }));
}

export async function addCartItem({ userId, product_id, quantity }) {
  const supabase = getSupabaseAdmin();
  if (!product_id) throw new Error('product_id is required');

  const qtyToAdd = parsePositiveInteger(quantity ?? 1, 'quantity');

  const { data: product, error: productErr } = await supabase
    .from('ladipo_parts')
    .select('id, is_active')
    .eq('id', product_id)
    .single();

  if (productErr || !product || product.is_active === false) {
    throw new Error(`Product ${product_id} not found`);
  }

  const { data: existing, error: existingErr } = await supabase
    .from('ladipo_cart_items')
    .select('id, quantity')
    .eq('user_id', userId)
    .eq('product_id', product_id)
    .maybeSingle();

  if (existingErr) {
    logError('[Ladipo] addCartItem existing lookup failed', existingErr);
    throw new Error('Failed to add cart item');
  }

  if (existing) {
    const updatedQty = existing.quantity + qtyToAdd;
    const { data: updated, error: updateErr } = await supabase
      .from('ladipo_cart_items')
      .update({ quantity: updatedQty })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select('id, user_id, product_id, quantity, created_at')
      .single();

    if (updateErr) {
      logError('[Ladipo] addCartItem update failed', updateErr);
      throw new Error('Failed to add cart item');
    }
    return updated;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('ladipo_cart_items')
    .insert({
      user_id: userId,
      product_id,
      quantity: qtyToAdd,
    })
    .select('id, user_id, product_id, quantity, created_at')
    .single();

  if (insertErr) {
    logError('[Ladipo] addCartItem insert failed', insertErr);
    throw new Error('Failed to add cart item');
  }

  return inserted;
}

export async function updateCartItemQuantity({ userId, cartItemId, quantity }) {
  const supabase = getSupabaseAdmin();
  if (!cartItemId) throw new Error('cart item id is required');

  const nextQuantity = parsePositiveInteger(quantity, 'quantity');
  const { data, error } = await supabase
    .from('ladipo_cart_items')
    .update({ quantity: nextQuantity })
    .eq('id', cartItemId)
    .eq('user_id', userId)
    .select('id, user_id, product_id, quantity, created_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116') throw new Error('Cart item not found');
    logError('[Ladipo] updateCartItemQuantity failed', error);
    throw new Error('Failed to update cart item');
  }

  return data;
}

export async function removeCartItem({ userId, cartItemId }) {
  const supabase = getSupabaseAdmin();
  if (!cartItemId) throw new Error('cart item id is required');

  const { data, error } = await supabase
    .from('ladipo_cart_items')
    .delete()
    .eq('id', cartItemId)
    .eq('user_id', userId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') throw new Error('Cart item not found');
    logError('[Ladipo] removeCartItem failed', error);
    throw new Error('Failed to remove cart item');
  }

  return data;
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function createOrder({ userId, items, delivery }) {
  const supabase = getSupabaseAdmin();

  if (!items || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  // Validate inventory row existence + compute line items.
  // Ladipo inventory is intentionally non-blocking (infinite-stock behavior),
  // so stock_qty is fetched for display/analytics only and never enforced here.
  const lineItems = [];
  let subtotal_kobo = 0;

  for (const { inventory_id, quantity } of items) {
    if (!inventory_id || !quantity || quantity < 1) {
      throw new Error('Each item needs inventory_id and a positive quantity');
    }

    const { data: inv, error: invErr } = await supabase
      .from('ladipo_part_inventory')
      .select('id, part_id, price_kobo, stock_qty, seller_label, part:ladipo_parts(id, slug, name, images)')
      .eq('id', inventory_id)
      .single();

    if (invErr || !inv) throw new Error(`Inventory item ${inventory_id} not found`);

    const lineTotal = inv.price_kobo * quantity;
    subtotal_kobo += lineTotal;

    lineItems.push({
      inventory_id: inv.id,
      part_id: inv.part_id,
      name: inv.part?.name || '',
      slug: inv.part?.slug || '',
      image_url: inv.part?.images?.[0] || null,
      unit_price_kobo: inv.price_kobo,
      quantity,
      line_total_kobo: lineTotal,
    });
  }

  const delivery_fee_kobo = await computeDeliveryFeeKobo(delivery);
  const total_kobo = subtotal_kobo + delivery_fee_kobo;
  if (total_kobo < 0) {
    throw new Error('Invalid total amount');
  }
  const order_number = `LAD-${Date.now().toString(36).toUpperCase()}`;

  const { data: order, error: orderErr } = await supabase
    .from('ladipo_orders')
    .insert({
      order_number,
      user_id: userId,
      items: lineItems,
      subtotal_kobo,
      delivery_fee_kobo,
      total_kobo,
      delivery: delivery || null,
      payment_status: 'pending_payment',
      order_status: 'pending_payment',
    })
    .select()
    .single();

  if (orderErr) {
    logError('[Ladipo] createOrder insert failed', orderErr);
    throw new Error('Failed to create order');
  }

  // Stock is intentionally unlimited for Ladipo products.
  // We only clear ordered products from cart after successful order creation.
  const orderedPartIds = [...new Set(lineItems.map((item) => item.part_id).filter(Boolean))];
  if (orderedPartIds.length > 0) {
    const { error: cartDeleteError } = await supabase
      .from('ladipo_cart_items')
      .delete()
      .eq('user_id', userId)
      .in('product_id', orderedPartIds);
    if (cartDeleteError) {
      logError('[Ladipo] cart cleanup failed after order creation', {
        order_number,
        user_id: userId,
        product_ids: orderedPartIds,
        error: cartDeleteError.message,
      });
    }
  }

  logInfo('[Ladipo] Order created', { order_number, user_id: userId, total_kobo });
  notifyLadipoOrderCreated(userId, order).catch(() => {});
  return order;
}

export async function payOrder({ orderNumber, userId, userEmail, payment_gateway = 'paystack' }) {
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from('ladipo_orders')
    .select('id, order_number, user_id, total_kobo, payment_status, paystack_reference')
    .eq('order_number', orderNumber)
    .eq('user_id', userId)
    .single();

  if (error || !order) throw new Error('Order not found');
  if (order.payment_status === 'paid') throw new Error('Order already paid');
  if (order.payment_status === 'failed') throw new Error('Order payment failed — please create a new order');

  // Use email from auth token; optionally enrich with profile for Monicredit customer fields
  const email = userEmail;
  if (!email) throw new Error('Could not resolve user email for payment');

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, phone')
    .eq('id', userId)
    .single();

  const frontendUrl = process.env.FRONTEND_URL || 'https://app.motoka.ng';

  // ── Monicredit flow ─────────────────────────────────────────────────────
  if (payment_gateway === 'monicredit') {
    const orderId = `LADIPO-${orderNumber}`;
    const totalAmountNaira = order.total_kobo / 100;

    const rawResult = await initMonicredit({
      order_id: orderId,
      customer: {
        email,
        first_name: profile?.first_name || 'Customer',
        last_name: profile?.last_name || 'Motoka',
        phone: profile?.phone || '',
      },
      items: [{ item: 'Ladipo marketplace order', unit_cost: totalAmountNaira }],
      total_amount: totalAmountNaira,
    });

    const normalized = MonicreditNormalizer.normalizeInitResponse(rawResult?.data || rawResult);
    const gatewayReference = normalized.order_id || orderId;

    // Store gateway reference on order so user/webhook verification uses a shared lifecycle.
    await supabase
      .from('ladipo_orders')
      .update({ paystack_reference: gatewayReference, updated_at: new Date().toISOString() })
      .eq('id', order.id);

    logInfo('[Ladipo] Monicredit payment initialised', { orderNumber, orderId, amount: totalAmountNaira });

    return {
      gateway: 'monicredit',
      payment_method: 'monicredit',
      order_id: orderId,
      reference: gatewayReference,
      account_number: normalized.account_number,
      bank_name: normalized.bank_name,
      account_name: normalized.account_name,
      total_amount: totalAmountNaira,
      amount: totalAmountNaira,
      expires_at: normalized.expires_at,
      payment_url: normalized.payment_url || null,
    };
  }

  // ── Paystack flow (default) ─────────────────────────────────────────────
  const reference = `ladipo_${orderNumber}_${Date.now()}`;
  const callback_url = `${frontendUrl}/ladipo/payment/callback`;

  const paystackResult = await initializeTransaction({
    email,
    amount: order.total_kobo,
    reference,
    callback_url,
    metadata: {
      order_number: orderNumber,
      payment_type: 'ladipo_parts',
      user_id: userId,
    },
  });

  // Store the reference on the order
  await supabase
    .from('ladipo_orders')
    .update({ paystack_reference: reference, updated_at: new Date().toISOString() })
    .eq('id', order.id);

  logInfo('[Ladipo] Payment initialised', { orderNumber, reference, amount: order.total_kobo });
  return { authorization_url: paystackResult.authorization_url, reference };
}

export async function verifyAndFulfillOrder(reference, userId = null, options = {}) {
  const supabase = getSupabaseAdmin();
  const gateway = resolveLadipoGateway(reference, options.gateway);

  let query = supabase
    .from('ladipo_orders')
    .select('id, order_number, user_id, total_kobo, payment_status, items')
    .eq('paystack_reference', reference);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data: order, error } = await query.single();

  if (error || !order) {
    if (userId) {
      const ownershipError = new Error('Order not found');
      ownershipError.statusCode = 404;
      throw ownershipError;
    }
    return null;
  }

  // Idempotent: already processed
  if (order.payment_status === 'paid') {
    logDebug('[Ladipo] verifyAndFulfillOrder: already paid', { reference, gateway });
    return order;
  }

  // Verify with gateway
  const verifyResult = await verifyLadipoPaymentWithGateway(reference, gateway);
  if (!verifyResult.isSuccessful) {
    const wasPending = order.payment_status === 'pending_payment';
    await supabase
      .from('ladipo_orders')
      .update({ payment_status: 'failed', order_status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id);
    logError('[Ladipo] Payment verification failed', { reference, gateway, status: verifyResult.status });
    if (wasPending) {
      notifyLadipoPaymentFailed(order.user_id, order, 'verification').catch(() => {});
    }
    return null;
  }

  // Amount check
  if (typeof verifyResult.amountKobo === 'number' && verifyResult.amountKobo !== order.total_kobo) {
    logError('[Ladipo] Amount mismatch on verify', {
      reference,
      gateway,
      expected: order.total_kobo,
      actual: verifyResult.amountKobo,
    });
    const wasPendingAmt = order.payment_status === 'pending_payment';
    await supabase
      .from('ladipo_orders')
      .update({ payment_status: 'failed', order_status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (wasPendingAmt) {
      notifyLadipoPaymentFailed(order.user_id, order, 'amount_mismatch').catch(() => {});
    }
    return null;
  }

  // Mark paid + processing
  const { data: updated, error: updateErr } = await supabase
    .from('ladipo_orders')
    .update({
      payment_status: 'paid',
      order_status: 'processing',
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select()
    .single();

  if (updateErr) {
    logError('[Ladipo] Failed to mark order paid', updateErr);
    throw new Error('Failed to update order payment status');
  }

  // Ladipo stock is not decremented after payment. Inventory remains display-only.

  logInfo('[Ladipo] Order fulfilled', { order_number: order.order_number, reference, gateway });
  notifyLadipoPaymentSuccess(updated.user_id, updated).catch(() => {});
  return updated;
}

export async function markLadipoOrderPaymentFailed(reference, options = {}) {
  const supabase = getSupabaseAdmin();
  const gateway = resolveLadipoGateway(reference, options.gateway);

  const { data: order, error } = await supabase
    .from('ladipo_orders')
    .select('id, order_number, payment_status, user_id, items, total_kobo')
    .eq('paystack_reference', reference)
    .single();

  if (error || !order) return null;
  if (order.payment_status === 'paid') return order;
  if (order.payment_status === 'failed') return order;

  const wasPending = order.payment_status === 'pending_payment';

  await supabase
    .from('ladipo_orders')
    .update({ payment_status: 'failed', order_status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', order.id);

  logInfo('[Ladipo] Order marked failed', { order_number: order.order_number, reference, gateway });
  if (wasPending && order.user_id) {
    notifyLadipoPaymentFailed(order.user_id, order, 'gateway').catch(() => {});
  }
  return order;
}

// ─── User order queries ───────────────────────────────────────────────────────

export async function getUserOrders(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_orders')
    .select('id, order_number, total_kobo, payment_status, order_status, items, created_at, paid_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logError('[Ladipo] getUserOrders failed', error);
    throw new Error('Failed to fetch orders');
  }
  return data || [];
}

export async function getOrderByNumber({ orderNumber, userId }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ladipo_orders')
    .select('*')
    .eq('order_number', orderNumber)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logError('[Ladipo] getOrderByNumber failed', error);
    throw new Error('Failed to fetch order');
  }
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenPart(part) {
  if (!part) return part;
  const inventoryRows = Array.isArray(part.inventory) ? part.inventory : [];
  const primaryInv = inventoryRows[0] || null;
  const compatibilityRows = Array.isArray(part.compatibility) ? part.compatibility : [];
  return {
    ...part,
    inventory_id: primaryInv?.id ?? null,
    price_kobo: primaryInv?.price_kobo ?? null,
    stock_qty: primaryInv?.stock_qty ?? 0,
    seller_label: primaryInv?.seller_label ?? 'Motoka',
    primary_image_url: part.images?.[0] ?? null,
    compatibility: compatibilityRows,
    inventory: undefined, // remove raw array
  };
}

async function computeDeliveryFeeKobo(delivery) {
  const method = String(delivery?.method || '').trim().toLowerCase();
  if (!method) {
    throw new Error('Invalid delivery method');
  }

  if (method === 'pickup') {
    return 0;
  }

  const stateInput = String(delivery?.state || '').trim();
  if (!stateInput) {
    throw new Error('State is required for delivery');
  }

  const normalizedStateInput = normalizeStateInput(stateInput);
  const states = await getAllStates();
  const matchedState = (states || []).find((state) => {
    const stateCode = normalizeStateInput(state.code);
    const stateName = normalizeStateInput(state.name);
    return normalizedStateInput === stateCode || normalizedStateInput === stateName;
  });

  const fallbackStateCode = normalizedStateInput === 'fct' ? 'FC' : null;
  const stateCode = matchedState?.code || fallbackStateCode;
  if (!stateCode) {
    throw new Error('Invalid delivery state');
  }

  const fee = await getDeliveryFee(stateCode);
  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error('Invalid delivery fee');
  }
  return Math.trunc(fee);
}

function normalizeStateInput(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parsePositiveInteger(value, fieldName) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`${fieldName} must be an integer greater than or equal to 1`);
  }
  return num;
}

function resolveLadipoGateway(reference, explicitGateway) {
  if (explicitGateway) return String(explicitGateway).toLowerCase();
  if (String(reference || '').startsWith('LADIPO-')) return 'monicredit';
  return 'paystack';
}

async function verifyLadipoPaymentWithGateway(reference, gateway) {
  if (gateway === 'monicredit') {
    const monicreditResult = await MonicreditAdapter.verifyPayment(reference);
    const status = String(monicreditResult.status || '').toLowerCase();
    return {
      status: monicreditResult.status,
      amountKobo: monicreditResult.amount,
      isSuccessful: status === 'approved' || status === 'success',
    };
  }

  const paystackResult = await verifyTransaction(reference);
  return {
    status: paystackResult.status,
    amountKobo: paystackResult.amount,
    isSuccessful: paystackResult.status === 'success',
  };
}
