import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { logError, logInfo } from '../utils/logger.js';
import { retryPayout, markPaidManually, reconcilePayout } from '../services/agents/agentPayout.service.js';
import { assignOrderManually, reassignOrder } from '../services/agents/agentPipeline.service.js';
import { DEFAULT_COST_STATE, orderLines, resolveOrderState } from '../services/agents/agentCost.service.js';
import { ORDER_TABLES, isOrderCancelled, isOrderOnHold, setAgentWorkStatus } from '../services/agents/agentWork.service.js';
import { NIN_COLUMNS, removeAgentDocuments, signAgentDocument, uploadAgentNin } from '../services/agents/agentDocuments.service.js';
import { autoPayoutLimitKobo, payoutsEnabled } from '../services/agents/monipayTransfer.service.js';

/**
 * ADMIN — AGENT FULFILMENT PIPELINE
 *
 * Three surfaces: the agents themselves, the cost table, and the payout queue.
 * The payout queue is the one that replaces the operator's mental bookkeeping,
 * so it joins agent name and a human order reference rather than raw ids.
 */

// ─── Agents ─────────────────────────────────────────────────────────────────

function withStates({ agent_states, ...agent }) {
  return { ...agent, states: (agent_states || []).map((row) => row.state).sort() };
}

/**
 * Returns the cleaned list, or null when `states` is not a list of names. A
 * multipart form can only send text, so the list may arrive as a JSON string.
 */
function parseStates(input) {
  let states = input;
  if (typeof input === 'string') {
    try {
      states = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(states) || states.some((s) => typeof s !== 'string')) return null;
  return [...new Set(states.map((s) => s.trim()).filter(Boolean))];
}

const accountNumberValid = (value) => !value || /^\d{10}$/.test(String(value).trim());

/** Upload whichever NIN sides came with the request. Returns the agent columns to save. */
async function uploadNinFiles(agentId, files) {
  const columns = {};
  for (const [side, column] of Object.entries(NIN_COLUMNS)) {
    const file = files?.[`nin_${side}`]?.[0];
    if (file) columns[column] = await uploadAgentNin({ agentId, side, file });
  }
  return columns;
}

/** Replace the states an agent covers. Returns false if the write failed. */
async function saveAgentStates(agentId, states) {
  const supabase = getSupabaseAdmin();
  const { error: deleteError } = await supabase.from('agent_states').delete().eq('agent_id', agentId);
  if (deleteError) return false;
  if (states.length === 0) return true;
  const { error } = await supabase.from('agent_states').insert(states.map((state) => ({ agent_id: agentId, state })));
  return !error;
}

export async function listAgents(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agents')
      .select('*, agent_states(state)')
      .order('created_at', { ascending: false });

    if (error) return response.serverError(res, 'Failed to load agents');
    return response.success(res, (data || []).map(withStates));
  } catch (err) {
    logError('[AdminAgents] listAgents error', err);
    return response.serverError(res, 'Failed to load agents');
  }
}

export async function createAgent(req, res) {
  try {
    const { name, phone, email, bank_name, bank_code, account_number, account_name, notes, states } = req.body || {};
    if (!name || !String(name).trim()) {
      return response.error(res, 'name is required');
    }
    const coverage = parseStates(states ?? []);
    if (!coverage) return response.error(res, 'states must be a list of state names');
    if (!accountNumberValid(account_number)) return response.error(res, 'account_number must be 10 digits');
    if (!req.files?.nin_front?.[0]) {
      return response.error(res, 'NIN front is required');
    }

    // Upload before inserting, so a failed upload cannot leave an agent with no ID on file.
    const id = randomUUID();
    const ninColumns = await uploadNinFiles(id, req.files);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agents')
      .insert({
        id,
        ...ninColumns,
        name: String(name).trim(),
        phone: phone || null,
        email: email || null,
        bank_name: bank_name || null,
        bank_code: bank_code || null,
        account_number: account_number ? String(account_number).trim() : null,
        account_name: account_name || null,
        notes: notes || null,
      })
      .select('*')
      .single();

    if (error) return response.serverError(res, 'Failed to create agent');
    if (!(await saveAgentStates(data.id, coverage))) {
      return response.serverError(res, 'Agent created, but saving their states failed. Edit the agent to set them.');
    }
    logInfo('[AdminAgents] Agent created', { agentId: data.id, name: data.name, adminId: req.admin?.id });
    return response.created(res, { ...data, states: coverage }, 'Agent created');
  } catch (err) {
    logError('[AdminAgents] createAgent error', err);
    return response.serverError(res, 'Failed to create agent');
  }
}

export async function updateAgent(req, res) {
  try {
    const { id } = req.params;
    const allowed = ['name', 'phone', 'email', 'bank_name', 'bank_code', 'account_number', 'account_name', 'status', 'notes'];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (patch.status && !['active', 'inactive'].includes(patch.status)) {
      return response.error(res, 'status must be active or inactive');
    }
    const coverage = req.body.states !== undefined ? parseStates(req.body.states) : undefined;
    if (coverage === null) return response.error(res, 'states must be a list of state names');
    if (!accountNumberValid(patch.account_number)) return response.error(res, 'account_number must be 10 digits');

    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from('agents')
      .select('id, nin_front_path, nin_back_path')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return response.notFound(res, 'Agent not found');

    const ninColumns = await uploadNinFiles(id, req.files);
    const { data, error } = await supabase
      .from('agents')
      .update({ ...patch, ...ninColumns, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) return response.serverError(res, 'Failed to update agent');
    if (!data) return response.notFound(res, 'Agent not found');

    // The new image is saved, so failing to clear the old one must not fail the update.
    const replaced = Object.keys(ninColumns).map((column) => existing[column]).filter(Boolean);
    await removeAgentDocuments(replaced).catch((err) => {
      logError('[AdminAgents] Failed to remove replaced NIN', { agentId: id, error: err.message });
    });

    if (coverage && !(await saveAgentStates(id, coverage))) {
      return response.serverError(res, 'Agent updated, but saving their states failed. Try again.');
    }
    logInfo('[AdminAgents] Agent updated', { agentId: id, fields: Object.keys(patch), adminId: req.admin?.id });
    return response.success(res, coverage ? { ...data, states: coverage } : data, 'Agent updated');
  } catch (err) {
    logError('[AdminAgents] updateAgent error', err);
    return response.serverError(res, 'Failed to update agent');
  }
}

export async function getAgentNinUrl(req, res) {
  try {
    const { id, side } = req.params;
    const column = NIN_COLUMNS[side];
    if (!column) return response.error(res, 'side must be front or back');

    const { data: agent, error } = await getSupabaseAdmin()
      .from('agents')
      .select(column)
      .eq('id', id)
      .maybeSingle();
    if (error) return response.serverError(res, 'Failed to load agent');
    if (!agent?.[column]) return response.notFound(res, 'No NIN on file');

    logInfo('[AdminAgents] NIN viewed', { agentId: id, side, adminId: req.admin?.id });
    return response.success(res, { url: await signAgentDocument(agent[column]) });
  } catch (err) {
    logError('[AdminAgents] getAgentNinUrl error', err);
    return response.serverError(res, 'Failed to open NIN');
  }
}

// ─── One agent's work ───────────────────────────────────────────────────────

const AGENT_ORDER_LIMIT = 500;
const ACTIVE_WORK = ['assigned', 'in_progress', 'submitted'];

function documentLabel(line, itemNames) {
  if (line.service_type === 'renewal_item') return itemNames.get(line.service_key) || line.service_key;
  if (line.service_type === 'plate_number') return `Plate number (${line.service_key})`;
  const [licenceType, duration] = line.service_key.split(':');
  return `Driver's licence (${licenceType}, ${duration})`;
}

export function summariseAgentOrders(orders) {
  const summary = { total: orders.length, working: 0, completed: 0, rejected: 0, paid_kobo: 0, owed_kobo: 0 };
  for (const order of orders) {
    if (ACTIVE_WORK.includes(order.work_status)) summary.working += 1;
    else if (order.work_status === 'completed') summary.completed += 1;
    else if (order.work_status === 'rejected') summary.rejected += 1;

    const amount = Number(order.agent_cost_kobo) || 0;
    if (order.payout_status === 'success') summary.paid_kobo += amount;
    else summary.owed_kobo += amount;
  }
  return summary;
}

/**
 * Every order currently assigned to this agent, with what the customer asked for
 * and where the work stands. assigned_agent_id is the source of truth, so an order
 * moved to someone else leaves this list, and one whose payout could not be
 * written still shows. A cancelled order only stays if the agent was already paid.
 */
export async function getAgentOrders(req, res) {
  try {
    const { id } = req.params;
    const supabase = getSupabaseAdmin();

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*, agent_states(state)')
      .eq('id', id)
      .maybeSingle();
    if (agentError) return response.serverError(res, 'Failed to load agent');
    if (!agent) return response.notFound(res, 'Agent not found');

    const [regular, guest, payouts, events, items] = await Promise.all([
      supabase
        .from('renewal_orders')
        .select('id, order_number, user_id, status, selected_items, metadata, renewal_state, delivery_state, agent_work_status, created_at, cars:car_id (registration_no, plate_number, vehicle_make, vehicle_model)')
        .eq('assigned_agent_id', id)
        .order('created_at', { ascending: false })
        .limit(AGENT_ORDER_LIMIT),
      supabase
        .from('guest_renewal_orders')
        .select('id, guest_name, plate_number, fulfillment_status, payment_status, selected_items, renewal_state, delivery_details, agent_work_status, created_at')
        .eq('assigned_agent_id', id)
        .order('created_at', { ascending: false })
        .limit(AGENT_ORDER_LIMIT),
      supabase
        .from('agent_payouts')
        .select('order_type, regular_order_id, guest_order_id, status, amount_kobo, profit_kobo, state, assigned_at, paid_at')
        .eq('agent_id', id)
        .neq('status', 'cancelled'),
      supabase
        .from('agent_order_events')
        .select('order_type, regular_order_id, guest_order_id, event_type, created_at')
        .eq('agent_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('renewal_items').select('item_key, name'),
    ]);
    if (regular.error || guest.error || payouts.error || events.error || items.error) {
      return response.serverError(res, 'Failed to load agent orders');
    }

    const orderKey = (row) => (row.order_type === 'regular' ? `regular:${row.regular_order_id}` : `guest:${row.guest_order_id}`);
    const payoutByOrder = new Map((payouts.data || []).map((row) => [orderKey(row), row]));
    const itemNames = new Map((items.data || []).map((item) => [item.item_key, item.name]));

    // Ascending order, so the last write for an order is its most recent event.
    const assignedAt = new Map();
    const lastUpdate = new Map();
    const completedAt = new Map();
    for (const event of events.data || []) {
      const key = orderKey(event);
      if (event.event_type === 'assigned' || event.event_type === 'reassigned') assignedAt.set(key, event.created_at);
      if (event.event_type === 'completed') completedAt.set(key, event.created_at);
      lastUpdate.set(key, event.created_at);
    }

    const userIds = [...new Set((regular.data || []).map((order) => order.user_id).filter(Boolean))];
    const profiles = userIds.length
      ? await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds)
      : { data: [] };
    const profileById = new Map((profiles.data || []).map((profile) => [profile.id, profile]));

    const toRow = (orderType, order, fields) => {
      const key = `${orderType}:${order.id}`;
      const payout = payoutByOrder.get(key);
      return {
        order_type: orderType,
        order_id: order.id,
        ...fields,
        documents: orderLines({ orderType, order }).map((line) => documentLabel(line, itemNames)),
        state: payout?.state || order.renewal_state || null,
        work_status: isOrderCancelled({ orderType, order }) ? 'cancelled' : order.agent_work_status || 'assigned',
        assigned_at: assignedAt.get(key) || payout?.assigned_at || order.created_at,
        last_update_at: lastUpdate.get(key) || payout?.assigned_at || order.created_at,
        completed_at: completedAt.get(key) || null,
        agent_cost_kobo: payout?.amount_kobo ?? null,
        profit_kobo: payout?.profit_kobo ?? null,
        payout_status: payout?.status || null,
        paid_at: payout?.paid_at || null,
      };
    };

    const orders = [
      ...(regular.data || []).map((order) => {
        const profile = profileById.get(order.user_id);
        const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
        return toRow('regular', order, {
          order_reference: order.order_number,
          order_slug: order.order_number,
          customer_name: name || null,
          plate: order.cars?.registration_no || order.cars?.plate_number || null,
          vehicle: [order.cars?.vehicle_make, order.cars?.vehicle_model].filter(Boolean).join(' ') || null,
        });
      }),
      ...(guest.data || []).map((order) => toRow('guest', order, {
        order_reference: 'Guest order',
        order_slug: order.id,
        customer_name: order.guest_name || null,
        plate: order.plate_number || null,
        vehicle: null,
      })),
    ].sort((a, b) => new Date(b.last_update_at) - new Date(a.last_update_at));

    return response.success(res, {
      agent: withStates(agent),
      orders,
      summary: summariseAgentOrders(orders),
      truncated: (regular.data || []).length === AGENT_ORDER_LIMIT || (guest.data || []).length === AGENT_ORDER_LIMIT,
    });
  } catch (err) {
    logError('[AdminAgents] getAgentOrders error', err);
    return response.serverError(res, 'Failed to load agent orders');
  }
}

// ─── Cost table ─────────────────────────────────────────────────────────────

export async function listAgentCosts(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agent_service_costs')
      .select('*')
      .order('service_type', { ascending: true })
      .order('service_key', { ascending: true })
      .order('state', { ascending: true });

    if (error) return response.serverError(res, 'Failed to load cost table');
    return response.success(res, data);
  } catch (err) {
    logError('[AdminAgents] listAgentCosts error', err);
    return response.serverError(res, 'Failed to load cost table');
  }
}

export async function upsertAgentCost(req, res) {
  try {
    const { service_type, service_key, cost_kobo, active, state } = req.body || {};
    const validTypes = ['renewal_item', 'plate_number', 'driver_license'];
    if (!validTypes.includes(service_type)) {
      return response.error(res, `service_type must be one of ${validTypes.join(', ')}`);
    }
    if (!service_key || !String(service_key).trim()) {
      return response.error(res, 'service_key is required');
    }
    const cost = Number(cost_kobo);
    if (!Number.isInteger(cost) || cost < 0) {
      return response.error(res, 'cost_kobo must be a non-negative integer (kobo)');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agent_service_costs')
      .upsert(
        {
          service_type,
          service_key: String(service_key).trim(),
          state: String(state || '').trim() || DEFAULT_COST_STATE,
          cost_kobo: cost,
          ...(active !== undefined ? { active: Boolean(active) } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'service_type,service_key,state' }
      )
      .select('*')
      .single();

    if (error) return response.serverError(res, 'Failed to save cost');
    logInfo('[AdminAgents] Cost saved', { service_type, service_key, cost_kobo: cost, adminId: req.admin?.id });
    return response.success(res, data, 'Cost saved');
  } catch (err) {
    logError('[AdminAgents] upsertAgentCost error', err);
    return response.serverError(res, 'Failed to save cost');
  }
}

// ─── Payout queue ───────────────────────────────────────────────────────────

export async function listPayouts(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('agent_payouts')
      .select('*, agents(name, bank_name, account_number)')
      .order('assigned_at', { ascending: false })
      .limit(300);

    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.agent_id) query = query.eq('agent_id', req.query.agent_id);
    if (req.query.order_type) query = query.eq('order_type', req.query.order_type);
    if (req.query.state) query = query.eq('state', req.query.state);

    const { data, error } = await query;
    if (error) return response.serverError(res, 'Failed to load payouts');

    // Attach a human order reference so the operator can act without cross-tabs.
    const rows = await Promise.all((data || []).map(decoratePayout));
    return response.success(res, {
      data: rows,
      meta: {
        auto_payouts_enabled: payoutsEnabled(),
        auto_payout_limit_kobo: autoPayoutLimitKobo(),
      },
    });
  } catch (err) {
    logError('[AdminAgents] listPayouts error', err);
    return response.serverError(res, 'Failed to load payouts');
  }
}

async function decoratePayout(payout) {
  const supabase = getSupabaseAdmin();
  let order_reference = null;
  let order_status = null;
  let agent_work_status = null;

  try {
    if (payout.order_type === 'regular' && payout.regular_order_id) {
      const { data } = await supabase
        .from('renewal_orders')
        .select('order_number, status, agent_work_status')
        .eq('id', payout.regular_order_id)
        .maybeSingle();
      order_reference = data?.order_number || `#${payout.regular_order_id}`;
      order_status = data?.status || null;
      agent_work_status = data?.agent_work_status || null;
    } else if (payout.order_type === 'guest' && payout.guest_order_id) {
      const { data } = await supabase
        .from('guest_renewal_orders')
        .select('id, payment_status, fulfillment_status, plate_number, agent_work_status')
        .eq('id', payout.guest_order_id)
        .maybeSingle();
      order_reference = data?.plate_number ? `Guest · ${data.plate_number}` : `Guest · ${String(payout.guest_order_id).slice(0, 8)}`;
      order_status = data?.fulfillment_status || data?.payment_status || null;
      agent_work_status = data?.agent_work_status || null;
    }
  } catch {
    // Decorating is best-effort — never fail the list because one order row is gone.
  }

  return {
    ...payout,
    agent_name: payout.agents?.name || null,
    agent_bank_name: payout.agents?.bank_name || null,
    agent_account_number: payout.agents?.account_number || null,
    order_reference,
    order_status,
    agent_work_status,
    agents: undefined,
  };
}

export async function retryPayoutHandler(req, res) {
  try {
    const { id } = req.params;
    const result = await retryPayout(id);
    if (result.error) return response.error(res, result.error);
    logInfo('[AdminAgents] Payout retried', { payoutId: id, adminId: req.admin?.id });
    return response.success(res, result.payout, 'Payout retried');
  } catch (err) {
    logError('[AdminAgents] retryPayout error', err);
    return response.serverError(res, 'Failed to retry payout');
  }
}

export async function markPayoutPaidManuallyHandler(req, res) {
  try {
    const { id } = req.params;
    const result = await markPaidManually(id, req.body?.note);
    if (result.error) return response.error(res, result.error);
    logInfo('[AdminAgents] Payout marked paid manually', { payoutId: id, adminId: req.admin?.id });
    return response.success(res, result.payout, 'Payout marked as paid');
  } catch (err) {
    logError('[AdminAgents] markPaidManually error', err);
    return response.serverError(res, 'Failed to mark payout paid');
  }
}

export async function reconcilePayoutHandler(req, res) {
  try {
    const { id } = req.params;
    const result = await reconcilePayout(id);
    if (result.error) return response.error(res, result.error);
    return response.success(res, result.payout, 'Payout reconciled');
  } catch (err) {
    logError('[AdminAgents] reconcilePayout error', err);
    return response.serverError(res, 'Failed to reconcile payout');
  }
}

/**
 * Manually assign an agent to an order that has none (orders that landed while
 * no agent was active, or after an assignment race). Creates the payout too.
 */
export async function assignAgentToOrderHandler(req, res) {
  try {
    const { order_type, order_id, agent_id } = req.body || {};
    if (!['regular', 'guest'].includes(order_type)) return response.error(res, 'order_type must be regular or guest');
    if (!order_id || !agent_id) return response.error(res, 'order_id and agent_id are required');

    const result = await assignOrderManually({ orderType: order_type, orderId: order_id, agentId: agent_id, actor: actorOf(req) });
    if (result.error) return response.error(res, result.error);
    logInfo('[AdminAgents] Agent assigned manually', { orderType: order_type, orderId: order_id, agentId: agent_id, adminId: req.admin?.id });
    return response.success(res, { agent: result.agent, cost: result.cost, payout: result.payout }, 'Agent assigned');
  } catch (err) {
    logError('[AdminAgents] assignAgentToOrder error', err);
    return response.serverError(res, 'Failed to assign agent');
  }
}

// ─── Agent on an order ──────────────────────────────────────────────────────

const actorOf = (req) => req.admin?.email || req.admin?.id || 'admin';

/**
 * Everything the order page shows: the current agent, the money, the history,
 * and who it could be reassigned to, with agents covering the state first.
 */
export async function getOrderAgentHandler(req, res) {
  try {
    const { type, id } = req.params;
    if (!ORDER_TABLES[type]) return response.error(res, 'order type must be regular or guest');

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase.from(ORDER_TABLES[type]).select('*').eq('id', id).maybeSingle();
    if (error || !order) return response.notFound(res, 'Order not found');

    const orderColumn = type === 'regular' ? 'regular_order_id' : 'guest_order_id';
    const [state, payouts, events, agents] = await Promise.all([
      resolveOrderState({ order }),
      supabase.from('agent_payouts').select('*').eq('order_type', type).eq(orderColumn, id).order('assigned_at', { ascending: false }),
      supabase.from('agent_order_events').select('*, agents(name)').eq('order_type', type).eq(orderColumn, id).order('created_at', { ascending: false }),
      supabase.from('agents').select('id, name, status, agent_states(state)').order('name', { ascending: true }),
    ]);
    if (payouts.error || events.error || agents.error) return response.serverError(res, 'Failed to load agent details');

    const allAgents = (agents.data || [])
      .map(withStates)
      .map((a) => ({ id: a.id, name: a.name, status: a.status, states: a.states, covers_state: Boolean(state && a.states.includes(state)) }));
    const candidates = allAgents
      .filter((a) => a.status === 'active')
      .sort((a, b) => Number(b.covers_state) - Number(a.covers_state));

    return response.success(res, {
      state,
      on_hold: isOrderOnHold({ orderType: type, order }),
      order_cancelled: isOrderCancelled({ orderType: type, order }),
      scheduled_for: order.scheduled_for || null,
      agent_work_status: order.agent_work_status || null,
      agent: allAgents.find((a) => a.id === order.assigned_agent_id) || null,
      payouts: payouts.data || [],
      events: (events.data || []).map(({ agents: eventAgent, ...event }) => ({ ...event, agent_name: eventAgent?.name || null })),
      candidates,
    });
  } catch (err) {
    logError('[AdminAgents] getOrderAgent error', err);
    return response.serverError(res, 'Failed to load agent details');
  }
}

export async function updateOrderAgentStatusHandler(req, res) {
  try {
    const { type, id } = req.params;
    if (!ORDER_TABLES[type]) return response.error(res, 'order type must be regular or guest');
    const { status, note } = req.body || {};

    const result = await setAgentWorkStatus({ orderType: type, orderId: id, status, note: note || null, actor: actorOf(req) });
    if (result.error) return response.error(res, result.error);
    return response.success(res, result, 'Progress updated');
  } catch (err) {
    logError('[AdminAgents] updateOrderAgentStatus error', err);
    return response.serverError(res, 'Failed to update progress');
  }
}

export async function reassignOrderHandler(req, res) {
  try {
    const { type, id } = req.params;
    if (!ORDER_TABLES[type]) return response.error(res, 'order type must be regular or guest');
    const { agent_id, note } = req.body || {};
    if (!agent_id) return response.error(res, 'agent_id is required');

    const result = await reassignOrder({ orderType: type, orderId: id, agentId: agent_id, note: note || null, actor: actorOf(req) });
    if (result.error) return response.error(res, result.error);
    return response.success(res, { agent: result.agent, cost: result.cost, payout: result.payout }, 'Agent reassigned');
  } catch (err) {
    logError('[AdminAgents] reassignOrder error', err);
    return response.serverError(res, 'Failed to reassign agent');
  }
}

// ─── Reports ────────────────────────────────────────────────────────────────

const REPORT_PAGE_SIZE = 1000;

function emptyTotals() {
  return { orders: 0, customer_kobo: 0, cost_kobo: 0, profit_kobo: 0, paid_kobo: 0, owed_kobo: 0, unpriced_orders: 0 };
}

/** Cancelled rows were replaced by another row, so counting them would double up. */
export function summarisePayouts(rows) {
  const overall = emptyTotals();
  const byAgent = new Map();
  const byState = new Map();

  const add = (totals, row) => {
    totals.orders += 1;
    totals.customer_kobo += Number(row.customer_amount_kobo) || 0;
    totals.cost_kobo += Number(row.amount_kobo) || 0;
    if (row.profit_kobo === null || row.profit_kobo === undefined) totals.unpriced_orders += 1;
    else totals.profit_kobo += Number(row.profit_kobo);
    if (row.status === 'success') totals.paid_kobo += Number(row.amount_kobo) || 0;
    else totals.owed_kobo += Number(row.amount_kobo) || 0;
  };
  const bucket = (map, key, extra) => {
    if (!map.has(key)) map.set(key, { ...extra, ...emptyTotals() });
    return map.get(key);
  };

  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    add(overall, row);
    add(bucket(byAgent, row.agent_id, { agent_id: row.agent_id, agent_name: row.agents?.name || null }), row);
    add(bucket(byState, row.state || 'Unknown', { state: row.state || 'Unknown' }), row);
  }

  return { overall, by_agent: [...byAgent.values()], by_state: [...byState.values()] };
}

export async function agentReportHandler(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const rows = [];

    // PostgREST caps a response at 1000 rows, and a truncated total is wrong money.
    for (let from = 0; ; from += REPORT_PAGE_SIZE) {
      let query = supabase
        .from('agent_payouts')
        .select('agent_id, state, status, amount_kobo, customer_amount_kobo, profit_kobo, agents(name)')
        .order('assigned_at', { ascending: false })
        .range(from, from + REPORT_PAGE_SIZE - 1);
      if (req.query.from) query = query.gte('assigned_at', req.query.from);
      if (req.query.to) query = query.lte('assigned_at', req.query.to);

      const { data, error } = await query;
      if (error) return response.serverError(res, 'Failed to load agent report');
      rows.push(...(data || []));
      if (!data || data.length < REPORT_PAGE_SIZE) break;
    }

    return response.success(res, summarisePayouts(rows));
  } catch (err) {
    logError('[AdminAgents] agentReport error', err);
    return response.serverError(res, 'Failed to load agent report');
  }
}
