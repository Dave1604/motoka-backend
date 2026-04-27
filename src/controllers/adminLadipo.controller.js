import { getSupabaseAdmin } from '../config/supabase.js';
import { createHash } from 'node:crypto';
import { logError, logInfo } from '../utils/logger.js';
import { deleteFromCloudinary, uploadToCloudinary } from '../services/fileUpload.service.js';
import { withIdempotency } from '../services/ladipo/ladipoAdminIdempotency.service.js';
import {
  notifyLadipoOrderCancelled,
  notifyLadipoOrderDelivered,
  notifyLadipoOrderOutForDelivery,
  notifyLadipoOrderProcessing,
} from '../services/ladipo/ladipoNotifications.service.js';

export const LADIPO_ADMIN_API_VERSION = '2.1.0';

const LADIPO_ADMIN_STATUS_MAP = {
  pending_payment: 'pending_payment',
  processing: 'processing',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

const DB_TO_ADMIN_STATUS = {
  pending_payment: 'pending_payment',
  processing: 'processing',
  shipped: 'out_for_delivery',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

const ALLOWED_STATUS_TRANSITIONS = {
  pending_payment: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const PRODUCT_CONDITIONS = new Set(['new', 'tokunbo', 'nigerian_used']);
const PRODUCT_PART_TYPES = new Set(['oem', 'oes', 'aftermarket']);

const formatKoboToNaira = (kobo) => (Number(kobo || 0) / 100).toLocaleString('en-NG');
const normalizeHandlerName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

function handlerKeyFromDisplayName(name) {
  const n = normalizeHandlerName(name);
  if (!n || n.length < 2) return null;
  return n.toLowerCase();
}

function parseExpectedAdminOpsVersion(body) {
  const raw = body?.expected_admin_ops_version;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readIdempotencyKey(req) {
  return String(req.get('Idempotency-Key') || req.headers['idempotency-key'] || '').trim();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildIdempotencyFingerprint(req, mutation, orderNumber, payload) {
  const raw = {
    admin_id: req.admin?.id || null,
    mutation,
    order_number: orderNumber,
    payload,
  };
  return createHash('sha256').update(stableStringify(raw)).digest('hex');
}

function mapLadipoOrder(order) {
  const derivedKey = order.handled_by_key
    || (order.handled_by_name ? handlerKeyFromDisplayName(order.handled_by_name) : null);
  return {
    id: order.id,
    order_number: order.order_number,
    user_id: order.user_id,
    user_name: order.profile
      ? `${order.profile.first_name || ''} ${order.profile.last_name || ''}`.trim() || 'Unknown user'
      : 'Unknown user',
    user_email: order.profile?.email || null,
    items: order.items || [],
    subtotal_kobo: order.subtotal_kobo,
    delivery_fee_kobo: order.delivery_fee_kobo,
    total_kobo: order.total_kobo,
    total_naira: `₦${formatKoboToNaira(order.total_kobo)}`,
    payment_status: order.payment_status,
    order_status: DB_TO_ADMIN_STATUS[order.order_status] || order.order_status,
    delivery: order.delivery,
    handled_by_name: order.handled_by_name || null,
    handled_by_key: derivedKey,
    assigned_at: order.assigned_at || null,
    assigned_by_name: order.assigned_by_name || null,
    released_at: order.released_at || null,
    workflow_state: order.workflow_state || 'active',
    block_reason: order.block_reason || null,
    admin_ops_version: Number(order.admin_ops_version ?? 0),
    created_at: order.created_at,
    updated_at: order.updated_at,
    paid_at: order.paid_at,
  };
}

function normalizeProductPayload(payload = {}) {
  const slug = String(payload.slug || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  const categoryId = payload.category_id || null;
  const brand = payload.brand ? String(payload.brand).trim() : null;
  const description = payload.description ? String(payload.description).trim() : null;
  const condition = String(payload.condition || 'new').trim().toLowerCase();
  const partType = String(payload.part_type || 'aftermarket').trim().toLowerCase();
  const isActive = payload.is_active !== undefined
    ? String(payload.is_active).toLowerCase() === 'true' || payload.is_active === true
    : true;
  const isUniversal = payload.is_universal !== undefined
    ? String(payload.is_universal).toLowerCase() === 'true' || payload.is_universal === true
    : false;
  let images = [];
  if (Array.isArray(payload.images)) {
    images = payload.images;
  } else if (typeof payload.images === 'string' && payload.images.trim()) {
    const raw = payload.images.trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) images = parsed;
      } catch {
        images = raw.split(',').map((item) => item.trim()).filter(Boolean);
      }
    } else {
      images = raw.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  const specifications = payload.specifications && typeof payload.specifications === 'object'
    ? payload.specifications
    : {};
  const keyFeatures = Array.isArray(payload.key_features) ? payload.key_features : [];
  const price_kobo = Number(payload.price_kobo);
  const stock_qty = Number(payload.stock_qty ?? 0);

  if (!slug || !name) {
    throw new Error('name and slug are required');
  }
  if (!categoryId) {
    throw new Error('category_id is required');
  }
  if (!PRODUCT_CONDITIONS.has(condition)) {
    throw new Error('condition must be new, tokunbo, or nigerian_used');
  }
  if (!PRODUCT_PART_TYPES.has(partType)) {
    throw new Error('part_type must be oem, oes, or aftermarket');
  }
  if (!Number.isInteger(price_kobo) || price_kobo < 0) {
    throw new Error('price_kobo must be a non-negative integer');
  }
  if (!Number.isInteger(stock_qty) || stock_qty < 0) {
    throw new Error('stock_qty must be a non-negative integer');
  }

  return {
    part: {
      slug,
      name,
      category_id: categoryId,
      brand,
      description,
      condition,
      part_type: partType,
      is_universal: isUniversal,
      is_active: isActive,
      images,
      specifications,
      key_features: keyFeatures,
    },
    inventory: {
      price_kobo,
      stock_qty,
      seller_label: String(payload.seller_label || 'Motoka').trim() || 'Motoka',
    },
  };
}

export async function getLadipoAdminCapabilities(req, res) {
  return res.status(200).json({
    status: true,
    message: 'Ladipo admin capabilities',
    data: {
      api_version: LADIPO_ADMIN_API_VERSION,
      assignee_route: true,
      workflow_route: true,
      idempotency_header: 'Idempotency-Key',
      concurrency_field: 'expected_admin_ops_version',
    },
  });
}

export async function listLadipoOrders(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.per_page) || 15));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = String(req.query.search || '').trim();
    const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
    const dbStatusFilter = LADIPO_ADMIN_STATUS_MAP[statusFilter] || null;
    const workflowState = String(req.query.workflow_state || '').trim().toLowerCase();
    const unassignedOnly = String(req.query.unassigned || '').toLowerCase() === '1'
      || String(req.query.unassigned || '').toLowerCase() === 'true';
    const handlerKey = String(req.query.handler_key || '').trim().toLowerCase();
    const excludeHandlerKey = String(req.query.exclude_handler_key || '').trim().toLowerCase();

    let query = supabase
      .from('ladipo_orders')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (statusFilter !== 'all') {
      if (!dbStatusFilter) {
        return res.status(400).json({ status: false, message: 'Invalid status filter' });
      }
      query = query.eq('order_status', dbStatusFilter);
    }

    if (workflowState === 'active' || workflowState === 'blocked') {
      query = query.eq('workflow_state', workflowState);
    }

    if (unassignedOnly) {
      query = query.is('handled_by_key', null).is('handled_by_name', null);
    } else if (handlerKey) {
      query = query.eq('handled_by_key', handlerKey);
    } else if (excludeHandlerKey) {
      query = query.not('handled_by_key', 'is', null).neq('handled_by_key', excludeHandlerKey);
    }

    if (search) {
      query = query.ilike('order_number', `%${search}%`);
    }

    const { data: orders, count, error } = await query;
    if (error) throw error;

    const userIds = [...new Set((orders || []).map((o) => o.user_id).filter(Boolean))];
    let profileMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', userIds);
      profileMap = new Map((profiles || []).map((p) => [p.id, p]));
    }

    const data = (orders || []).map((order) => mapLadipoOrder({
      ...order,
      profile: profileMap.get(order.user_id) || null,
    }));

    return res.status(200).json({
      status: true,
      message: 'Ladipo orders retrieved successfully',
      data: {
        data,
        current_page: page,
        per_page: limit,
        total: count || 0,
        last_page: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    logError('[Admin Ladipo] listLadipoOrders', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve Ladipo orders' });
  }
}

export async function getLadipoOrderDetails(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const { orderNumber } = req.params;

    const { data: order, error } = await supabase
      .from('ladipo_orders')
      .select('*')
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (error || !order) {
      return res.status(404).json({ status: false, message: 'Ladipo order not found' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', order.user_id)
      .maybeSingle();

    return res.status(200).json({
      status: true,
      message: 'Ladipo order retrieved successfully',
      data: mapLadipoOrder({ ...order, profile }),
    });
  } catch (error) {
    logError('[Admin Ladipo] getLadipoOrderDetails', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve Ladipo order' });
  }
}

export async function updateLadipoOrderStatus(req, res) {
  const idempotencyKey = readIdempotencyKey(req);
  const statusFingerprint = buildIdempotencyFingerprint(req, 'order_status', req.params.orderNumber, {
    status: String(req.body.status || '').trim().toLowerCase(),
    reason: String(req.body.reason || '').trim(),
    handled_by_name: normalizeHandlerName(String(req.body.handled_by_name || '').trim()),
    expected_admin_ops_version: parseExpectedAdminOpsVersion(req.body),
  });
  const runUpdate = async () => {
    const supabase = getSupabaseAdmin();
    const { orderNumber } = req.params;
    const requestedStatus = String(req.body.status || '').trim().toLowerCase();
    const cancelReason = String(req.body.reason || '').trim();
    const handledByName = normalizeHandlerName(String(req.body.handled_by_name || '').trim());
    const mappedStatus = LADIPO_ADMIN_STATUS_MAP[requestedStatus];

    if (!mappedStatus) {
      return { status: 400, body: { status: false, message: 'Invalid status. Use pending_payment, processing, out_for_delivery, delivered, or cancelled' } };
    }

    const { data: currentOrder, error: currentError } = await supabase
      .from('ladipo_orders')
      .select('*')
      .eq('order_number', orderNumber)
      .single();

    if (currentError || !currentOrder) {
      return { status: 404, body: { status: false, message: 'Ladipo order not found' } };
    }

    const expectedVersion = parseExpectedAdminOpsVersion(req.body);
    const currentVersion = Number(currentOrder.admin_ops_version ?? 0);
    if (expectedVersion !== null && expectedVersion !== currentVersion) {
      return {
        status: 409,
        body: {
          status: false,
          code: 'CONFLICT',
          message: 'Order was updated by another session. Refresh and try again.',
          data: { admin_ops_version: currentVersion },
        },
      };
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[currentOrder.order_status] || [];
    if (!allowed.includes(mappedStatus)) {
      return {
        status: 409,
        body: {
          status: false,
          message: `Invalid status transition from ${DB_TO_ADMIN_STATUS[currentOrder.order_status] || currentOrder.order_status} to ${requestedStatus}`,
        },
      };
    }

    if (mappedStatus === 'processing' && currentOrder.payment_status !== 'paid') {
      return { status: 409, body: { status: false, message: 'Only paid orders can move to processing' } };
    }
    if (mappedStatus === 'cancelled' && !cancelReason) {
      return { status: 400, body: { status: false, message: 'Cancellation reason is required' } };
    }
    if (mappedStatus === 'cancelled' && cancelReason.length < 10) {
      return { status: 400, body: { status: false, message: 'Cancellation reason must be at least 10 characters' } };
    }
    if (!handledByName || handledByName.length < 2) {
      return { status: 400, body: { status: false, message: 'handled_by_name is required (min 2 characters)' } };
    }

    const nextVersion = currentVersion + 1;
    const versionGuard = expectedVersion ?? currentVersion;
    const handlerKey = handlerKeyFromDisplayName(handledByName);

    const { data: updatedOrder, error: updateError } = await supabase
      .from('ladipo_orders')
      .update({
        order_status: mappedStatus,
        handled_by_name: handledByName,
        handled_by_key: handlerKey,
        admin_ops_version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentOrder.id)
      .eq('admin_ops_version', versionGuard)
      .select('*')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedOrder) {
      const { data: latestOrder } = await supabase
        .from('ladipo_orders')
        .select('admin_ops_version')
        .eq('id', currentOrder.id)
        .maybeSingle();
      return {
        status: 409,
        body: {
          status: false,
          code: 'CONFLICT',
          message: 'Order was updated by another session. Refresh and try again.',
          data: { admin_ops_version: Number(latestOrder?.admin_ops_version ?? currentVersion) },
        },
      };
    }

    if (mappedStatus === 'processing') {
      notifyLadipoOrderProcessing(updatedOrder.user_id, updatedOrder).catch(() => {});
    }
    if (mappedStatus === 'shipped') {
      notifyLadipoOrderOutForDelivery(updatedOrder.user_id, updatedOrder).catch(() => {});
    }
    if (mappedStatus === 'delivered') {
      notifyLadipoOrderDelivered(updatedOrder.user_id, updatedOrder).catch(() => {});
    }
    if (mappedStatus === 'cancelled') {
      notifyLadipoOrderCancelled(updatedOrder.user_id, updatedOrder, cancelReason).catch(() => {});
    }

    logInfo('[Admin Ladipo] order_status_change', {
      order_number: updatedOrder.order_number,
      from_status: currentOrder.order_status,
      to_status: mappedStatus,
      actor_name: handledByName,
      admin_id: req.admin?.id,
      idempotency_key: idempotencyKey || undefined,
      workflow_state: currentOrder.workflow_state,
    });

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', updatedOrder.user_id)
      .maybeSingle();

    return {
      status: 200,
      body: {
        status: true,
        message: 'Ladipo order status updated successfully',
        data: mapLadipoOrder({ ...updatedOrder, profile }),
      },
    };
  };

  try {
    if (idempotencyKey) {
      const { status, body, replay } = await withIdempotency(
        `ladipo:order_status:${idempotencyKey}`,
        runUpdate,
        { fingerprint: statusFingerprint },
      );
      if (replay) logInfo('[Admin Ladipo] order_status_idempotent_replay', { idempotency_key: idempotencyKey });
      return res.status(status).json(body);
    }
    const out = await runUpdate();
    return res.status(out.status).json(out.body);
  } catch (error) {
    logError('[Admin Ladipo] updateLadipoOrderStatus', error);
    return res.status(500).json({ status: false, message: 'Failed to update Ladipo order status' });
  }
}

export async function updateLadipoOrderAssignee(req, res) {
  const idempotencyKey = readIdempotencyKey(req);
  const assigneeFingerprint = buildIdempotencyFingerprint(req, 'order_assignee', req.params.orderNumber, {
    handled_by_name: req.body.handled_by_name === null
      ? null
      : normalizeHandlerName(String(req.body.handled_by_name || '').trim()),
    assigned_by_name: normalizeHandlerName(String(req.body.assigned_by_name || '').trim()),
    expected_admin_ops_version: parseExpectedAdminOpsVersion(req.body),
  });
  const runAssign = async () => {
    const supabase = getSupabaseAdmin();
    const { orderNumber } = req.params;
    const rawHandledByName = req.body.handled_by_name;
    const handledByName = rawHandledByName === null ? null : normalizeHandlerName(rawHandledByName);
    const assignedByName = normalizeHandlerName(String(req.body.assigned_by_name || '').trim())
      || handledByName;

    if (handledByName !== null && handledByName.length < 2) {
      return { status: 400, body: { status: false, message: 'handled_by_name must be at least 2 characters or null' } };
    }

    const { data: currentOrder, error: currentError } = await supabase
      .from('ladipo_orders')
      .select('*')
      .eq('order_number', orderNumber)
      .single();

    if (currentError || !currentOrder) {
      return { status: 404, body: { status: false, message: 'Ladipo order not found' } };
    }

    const expectedVersion = parseExpectedAdminOpsVersion(req.body);
    const currentVersion = Number(currentOrder.admin_ops_version ?? 0);
    if (expectedVersion !== null && expectedVersion !== currentVersion) {
      return {
        status: 409,
        body: {
          status: false,
          code: 'CONFLICT',
          message: 'Order was updated by another session. Refresh and try again.',
          data: { admin_ops_version: currentVersion },
        },
      };
    }

    const nextVersion = currentVersion + 1;
    const nowIso = new Date().toISOString();
    const handlerKey = handledByName ? handlerKeyFromDisplayName(handledByName) : null;

    const updatePayload = handledByName === null
      ? {
        handled_by_name: null,
        handled_by_key: null,
        assigned_at: null,
        assigned_by_name: null,
        released_at: nowIso,
        admin_ops_version: nextVersion,
        updated_at: nowIso,
      }
      : {
        handled_by_name: handledByName,
        handled_by_key: handlerKey,
        assigned_at: nowIso,
        assigned_by_name: assignedByName || handledByName,
        released_at: null,
        admin_ops_version: nextVersion,
        updated_at: nowIso,
      };

    const versionGuard = expectedVersion ?? currentVersion;
    const { data: updatedOrder, error: updateError } = await supabase
      .from('ladipo_orders')
      .update(updatePayload)
      .eq('id', currentOrder.id)
      .eq('admin_ops_version', versionGuard)
      .select('*')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedOrder) {
      const { data: latestOrder } = await supabase
        .from('ladipo_orders')
        .select('admin_ops_version')
        .eq('id', currentOrder.id)
        .maybeSingle();
      return {
        status: 409,
        body: {
          status: false,
          code: 'CONFLICT',
          message: 'Order was updated by another session. Refresh and try again.',
          data: { admin_ops_version: Number(latestOrder?.admin_ops_version ?? currentVersion) },
        },
      };
    }

    logInfo('[Admin Ladipo] order_assignee_change', {
      order_number: updatedOrder.order_number,
      handled_by_name: handledByName,
      handled_by_key: handlerKey,
      assigned_by_name: assignedByName,
      from_handler: currentOrder.handled_by_name,
      admin_id: req.admin?.id,
      idempotency_key: idempotencyKey || undefined,
    });

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', updatedOrder.user_id)
      .maybeSingle();

    return {
      status: 200,
      body: {
        status: true,
        message: handledByName ? 'Order assigned successfully' : 'Order released successfully',
        data: mapLadipoOrder({ ...updatedOrder, profile }),
      },
    };
  };

  try {
    if (idempotencyKey) {
      const { status, body, replay } = await withIdempotency(
        `ladipo:order_assignee:${idempotencyKey}`,
        runAssign,
        { fingerprint: assigneeFingerprint },
      );
      if (replay) logInfo('[Admin Ladipo] order_assignee_idempotent_replay', { idempotency_key: idempotencyKey });
      return res.status(status).json(body);
    }
    const out = await runAssign();
    return res.status(out.status).json(out.body);
  } catch (error) {
    logError('[Admin Ladipo] updateLadipoOrderAssignee', error);
    return res.status(500).json({ status: false, message: 'Failed to update order assignee' });
  }
}

export async function updateLadipoOrderWorkflow(req, res) {
  const idempotencyKey = readIdempotencyKey(req);
  const workflowFingerprint = buildIdempotencyFingerprint(req, 'order_workflow', req.params.orderNumber, {
    workflow_state: String(req.body.workflow_state || '').trim().toLowerCase(),
    block_reason: String(req.body.block_reason || '').trim(),
    handled_by_name: normalizeHandlerName(String(req.body.handled_by_name || '').trim()),
    expected_admin_ops_version: parseExpectedAdminOpsVersion(req.body),
  });
  const runWorkflow = async () => {
    const supabase = getSupabaseAdmin();
    const { orderNumber } = req.params;
    const workflowState = String(req.body.workflow_state || '').trim().toLowerCase();
    const blockReason = String(req.body.block_reason || '').trim();
    const actorName = normalizeHandlerName(String(req.body.handled_by_name || '').trim());

    if (workflowState !== 'active' && workflowState !== 'blocked') {
      return { status: 400, body: { status: false, message: 'workflow_state must be active or blocked' } };
    }
    if (workflowState === 'blocked' && blockReason.length < 3) {
      return { status: 400, body: { status: false, message: 'block_reason is required (min 3 characters) when blocked' } };
    }
    if (!actorName || actorName.length < 2) {
      return { status: 400, body: { status: false, message: 'handled_by_name is required (min 2 characters)' } };
    }

    const { data: currentOrder, error: currentError } = await supabase
      .from('ladipo_orders')
      .select('*')
      .eq('order_number', orderNumber)
      .single();

    if (currentError || !currentOrder) {
      return { status: 404, body: { status: false, message: 'Ladipo order not found' } };
    }

    const expectedVersion = parseExpectedAdminOpsVersion(req.body);
    const currentVersion = Number(currentOrder.admin_ops_version ?? 0);
    if (expectedVersion !== null && expectedVersion !== currentVersion) {
      return {
        status: 409,
        body: {
          status: false,
          code: 'CONFLICT',
          message: 'Order was updated by another session. Refresh and try again.',
          data: { admin_ops_version: currentVersion },
        },
      };
    }

    const nextVersion = currentVersion + 1;
    const nowIso = new Date().toISOString();

    const versionGuard = expectedVersion ?? currentVersion;
    const { data: updatedOrder, error: updateError } = await supabase
      .from('ladipo_orders')
      .update({
        workflow_state: workflowState,
        block_reason: workflowState === 'blocked' ? blockReason : null,
        handled_by_name: actorName,
        handled_by_key: handlerKeyFromDisplayName(actorName),
        admin_ops_version: nextVersion,
        updated_at: nowIso,
      })
      .eq('id', currentOrder.id)
      .eq('admin_ops_version', versionGuard)
      .select('*')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedOrder) {
      const { data: latestOrder } = await supabase
        .from('ladipo_orders')
        .select('admin_ops_version')
        .eq('id', currentOrder.id)
        .maybeSingle();
      return {
        status: 409,
        body: {
          status: false,
          code: 'CONFLICT',
          message: 'Order was updated by another session. Refresh and try again.',
          data: { admin_ops_version: Number(latestOrder?.admin_ops_version ?? currentVersion) },
        },
      };
    }

    logInfo('[Admin Ladipo] order_workflow_change', {
      order_number: updatedOrder.order_number,
      workflow_state: workflowState,
      block_reason: workflowState === 'blocked' ? blockReason : null,
      actor_name: actorName,
      admin_id: req.admin?.id,
      idempotency_key: idempotencyKey || undefined,
    });

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', updatedOrder.user_id)
      .maybeSingle();

    return {
      status: 200,
      body: {
        status: true,
        message: workflowState === 'blocked' ? 'Order marked as blocked' : 'Order unblocked',
        data: mapLadipoOrder({ ...updatedOrder, profile }),
      },
    };
  };

  try {
    if (idempotencyKey) {
      const { status, body, replay } = await withIdempotency(
        `ladipo:order_workflow:${idempotencyKey}`,
        runWorkflow,
        { fingerprint: workflowFingerprint },
      );
      if (replay) logInfo('[Admin Ladipo] order_workflow_idempotent_replay', { idempotency_key: idempotencyKey });
      return res.status(status).json(body);
    }
    const out = await runWorkflow();
    return res.status(out.status).json(out.body);
  } catch (error) {
    logError('[Admin Ladipo] updateLadipoOrderWorkflow', error);
    return res.status(500).json({ status: false, message: 'Failed to update order workflow' });
  }
}

export async function listLadipoProducts(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.per_page) || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = String(req.query.search || '').trim();

    let query = supabase
      .from('ladipo_parts')
      .select(`
        id, slug, name, description, brand, condition, part_type, images, is_active, is_universal, category_id, created_at, updated_at,
        category:ladipo_categories(id, name, slug),
        inventory:ladipo_part_inventory(id, part_id, price_kobo, stock_qty, seller_label)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%,brand.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const products = (data || []).map((product) => ({
      ...product,
      inventory: Array.isArray(product.inventory) ? product.inventory[0] || null : product.inventory,
    }));

    return res.status(200).json({
      status: true,
      message: 'Ladipo products retrieved successfully',
      data: {
        data: products,
        current_page: page,
        per_page: limit,
        total: count || 0,
        last_page: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    logError('[Admin Ladipo] listLadipoProducts', error);
    return res.status(500).json({ status: false, message: 'Failed to retrieve Ladipo products' });
  }
}

export async function createLadipoProduct(req, res) {
  let uploadedImageUrl = null;
  try {
    const supabase = getSupabaseAdmin();
    const payload = normalizeProductPayload(req.body);
    if (req.file) {
      uploadedImageUrl = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      payload.part.images = [uploadedImageUrl, ...(payload.part.images || [])];
    }

    const { data: part, error: partError } = await supabase
      .from('ladipo_parts')
      .insert(payload.part)
      .select('*')
      .single();
    if (partError) throw partError;

    const { data: inventory, error: inventoryError } = await supabase
      .from('ladipo_part_inventory')
      .insert({
        part_id: part.id,
        ...payload.inventory,
      })
      .select('*')
      .single();
    if (inventoryError) throw inventoryError;

    return res.status(201).json({
      status: true,
      message: 'Ladipo product created successfully',
      data: { ...part, inventory },
    });
  } catch (error) {
    if (uploadedImageUrl) {
      await deleteFromCloudinary(uploadedImageUrl);
    }
    logError('[Admin Ladipo] createLadipoProduct', error);
    return res.status(400).json({ status: false, message: error.message || 'Failed to create Ladipo product' });
  }
}

export async function updateLadipoProduct(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const { productId } = req.params;
    const { data: existingPart } = await supabase
      .from('ladipo_parts')
      .select('images')
      .eq('id', productId)
      .maybeSingle();
    const payload = normalizeProductPayload(req.body);
    if (req.file) {
      const uploadedImageUrl = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      const existingImages = Array.isArray(existingPart?.images) ? existingPart.images : [];
      await Promise.all(existingImages.map((url) => deleteFromCloudinary(url)));
      payload.part.images = [uploadedImageUrl];
    } else if ((!payload.part.images || payload.part.images.length === 0) && existingPart?.images) {
      payload.part.images = existingPart.images;
    }

    const { data: part, error: partError } = await supabase
      .from('ladipo_parts')
      .update({
        ...payload.part,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)
      .select('*')
      .single();
    if (partError) throw partError;

    const { data: existingInventory } = await supabase
      .from('ladipo_part_inventory')
      .select('id')
      .eq('part_id', productId)
      .maybeSingle();

    let inventoryResult = null;
    if (existingInventory?.id) {
      const { data, error } = await supabase
        .from('ladipo_part_inventory')
        .update({
          ...payload.inventory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingInventory.id)
        .select('*')
        .single();
      if (error) throw error;
      inventoryResult = data;
    } else {
      const { data, error } = await supabase
        .from('ladipo_part_inventory')
        .insert({
          part_id: productId,
          ...payload.inventory,
        })
        .select('*')
        .single();
      if (error) throw error;
      inventoryResult = data;
    }

    return res.status(200).json({
      status: true,
      message: 'Ladipo product updated successfully',
      data: { ...part, inventory: inventoryResult },
    });
  } catch (error) {
    logError('[Admin Ladipo] updateLadipoProduct', error);
    return res.status(400).json({ status: false, message: error.message || 'Failed to update Ladipo product' });
  }
}

export async function deleteLadipoProduct(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const { productId } = req.params;

    const { data: existingPart } = await supabase
      .from('ladipo_parts')
      .select('images')
      .eq('id', productId)
      .maybeSingle();

    if (!existingPart) {
      return res.status(404).json({ status: false, message: 'Ladipo product not found' });
    }

    const existingImages = Array.isArray(existingPart?.images) ? existingPart.images : [];
    await Promise.all(existingImages.map((url) => deleteFromCloudinary(url)));

    const { error } = await supabase
      .from('ladipo_parts')
      .delete()
      .eq('id', productId);

    if (error) throw error;

    return res.status(200).json({
      status: true,
      message: 'Ladipo product deleted successfully',
    });
  } catch (error) {
    logError('[Admin Ladipo] deleteLadipoProduct', error);
    return res.status(500).json({ status: false, message: 'Failed to delete Ladipo product' });
  }
}
