import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import { computeOrderCost, resolveOrderState } from './agentCost.service.js';
import { createPayout, cancelPayouts } from './agentPayout.service.js';
import { sendPayoutAlert, sendUnassignedAlert } from './agentAlert.service.js';
import { ORDER_TABLES, isOrderCancelled, isOrderOnHold, recordAgentEvent } from './agentWork.service.js';

/**
 * ASSIGNMENT + PAYOUT ORCHESTRATION
 *
 * Called from the places a paid order becomes real work:
 *   - payment-success.service.js  (regular renewal_orders, after _startProcessing)
 *   - guestRenewal.service.js     (guest_renewal_orders, after markGuestOrderPaid)
 *   - renewalSweeper.service.js   (a held order, when its renewal window opens)
 *   - admin order actions         (an admin releasing a held order early)
 *
 * The first two are inside the customer's payment webhook path, so this
 * module is written to be boring: it never throws, it never blocks the webhook
 * for long, and every failure is logged rather than surfaced. The customer's
 * payment succeeding is the primary event; assigning an agent is a side effect.
 *
 * Order of operations for a paid order:
 *   1. pick an agent (least-recently-assigned active agent covering the order's state)
 *   2. stamp assigned_agent_id on the order so the admin UI can show it
 *   3. compute the cost for that state from the agent cost table
 *   4. create the ledger row, ready for an admin to release
 *
 * No money moves here. It only moves when an admin releases the payout.
 */
export async function runAgentPipeline({ orderType, order: paidOrder }) {
  try {
    const orderId = paidOrder.id;

    // Callers select only the columns they need, and this needs the state and
    // the amounts. Read the row rather than depend on every caller's column list.
    const order = (await loadOrder({ orderType, orderId })) || paidOrder;

    // Already assigned (replay / duplicate webhook)? Do nothing — the unique
    // index would catch a double payout anyway, but cheap check first.
    if (order.assigned_agent_id) {
      logInfo('[AgentPipeline] Already assigned, skipping', { orderType, orderId });
      return { skipped: 'already_assigned' };
    }

    // Held orders come back through here when they are released.
    if (isOrderOnHold({ orderType, order })) {
      logInfo('[AgentPipeline] Order on hold, assigning on release', { orderType, orderId });
      return { skipped: 'on_hold' };
    }

    if (isOrderCancelled({ orderType, order })) {
      logInfo('[AgentPipeline] Order cancelled, not assigning', { orderType, orderId });
      return { skipped: 'cancelled' };
    }

    const state = await resolveOrderState({ order });
    if (!state) {
      logInfo('[AgentPipeline] Order has no state, left unassigned', { orderType, orderId });
      await sendUnassignedAlert({ orderType, orderId, state, reason: 'The order has no renewal or delivery state.' });
      return { skipped: 'no_state' };
    }

    const agent = await pickAgent({ state });
    if (!agent) {
      logInfo('[AgentPipeline] No active agent for state, order left unassigned', { orderType, orderId, state });
      await sendUnassignedAlert({ orderType, orderId, state, reason: `No active agent covers ${state}.` });
      return { skipped: 'no_active_agent' };
    }

    const stamped = await stampAssignment({ orderType, orderId, agentId: agent.id });
    if (!stamped) {
      // Someone else won the race to assign it. Leave their work alone.
      return { skipped: 'assignment_race' };
    }
    await recordAgentEvent({ orderType, orderId, agentId: agent.id, eventType: 'assigned' });

    const cost = await computeOrderCost({ orderType, order, state });
    const payout = await createPayout({ orderType, orderId, agent, cost });

    return { agent, cost, payout };
  } catch (err) {
    // Never rethrow: this runs inside the payment webhook.
    logError('[AgentPipeline] Failed (non-fatal)', {
      orderType,
      orderId: paidOrder?.id,
      error: err.message,
      stack: err.stack,
    });
    return { error: err.message };
  }
}

async function loadOrder({ orderType, orderId }) {
  const { data, error } = await getSupabaseAdmin()
    .from(ORDER_TABLES[orderType])
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) logError('[AgentPipeline] Failed to load order', { orderType, orderId, error: error.message });
  return data || null;
}

/**
 * Round-robin within a state: of the active agents covering it, the one assigned
 * an order from that state least recently (or never). Implemented as "order by
 * last assignment time ascending" rather than a counter, because a counter has to
 * be incremented atomically and a lookup does not — and with a handful of agents
 * the difference is noise.
 */
export async function pickAgent({ state }) {
  const supabase = getSupabaseAdmin();

  const { data: coverage, error: coverageError } = await supabase
    .from('agent_states')
    .select('agent_id')
    .eq('state', state);

  if (coverageError) {
    logError('[AgentPipeline] Failed to load agent coverage', { state, error: coverageError.message });
    return null;
  }
  const agentIds = (coverage || []).map((row) => row.agent_id);
  if (agentIds.length === 0) return null;

  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, name, account_number, bank_code, account_name, status')
    .eq('status', 'active')
    .in('id', agentIds)
    .order('created_at', { ascending: true });

  if (error || !agents || agents.length === 0) {
    if (error) logError('[AgentPipeline] Failed to load agents', { error: error.message });
    return null;
  }

  const { data: recent } = await supabase
    .from('agent_payouts')
    .select('agent_id, assigned_at')
    .eq('state', state)
    .in('agent_id', agents.map((a) => a.id))
    .order('assigned_at', { ascending: false })
    .limit(200);

  const lastAssigned = new Map();
  for (const row of recent || []) {
    if (!lastAssigned.has(row.agent_id)) {
      lastAssigned.set(row.agent_id, new Date(row.assigned_at).getTime());
    }
  }

  let chosen = agents[0];
  let chosenAt = lastAssigned.get(chosen.id) ?? 0;
  for (const a of agents.slice(1)) {
    const at = lastAssigned.get(a.id) ?? 0;
    if (at < chosenAt) {
      chosen = a;
      chosenAt = at;
    }
  }
  return chosen;
}

async function stampAssignment({ orderType, orderId, agentId }) {
  const supabase = getSupabaseAdmin();
  const table = ORDER_TABLES[orderType];

  const { data, error } = await supabase
    .from(table)
    .update({ assigned_agent_id: agentId, agent_work_status: 'assigned', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .is('assigned_agent_id', null)
    .select('id')
    .maybeSingle();

  if (error) {
    logError('[AgentPipeline] Failed to stamp assignment', { table, orderId, error: error.message });
    return false;
  }
  return Boolean(data);
}

/**
 * Backfill helper for the admin: assign an agent to an order that currently has
 * none (e.g. it landed while no agent was active). Used by the manual-assign
 * endpoint.
 */
export async function assignOrderManually({ orderType, orderId, agentId, actor = 'admin' }) {
  const supabase = getSupabaseAdmin();

  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, account_number, bank_code, account_name, status')
    .eq('id', agentId)
    .maybeSingle();

  if (!agent) return { error: 'agent_not_found' };
  if (agent.status !== 'active') return { error: 'agent_inactive' };

  const order = await loadOrder({ orderType, orderId });
  if (!order) return { error: 'order_not_found' };
  if (order.assigned_agent_id) return { error: 'already_assigned' };
  if (isOrderOnHold({ orderType, order })) return { error: 'order_on_hold' };
  if (isOrderCancelled({ orderType, order })) return { error: 'order_cancelled' };

  const stamped = await stampAssignment({ orderType, orderId, agentId: agent.id });
  if (!stamped) return { error: 'assignment_race' };
  await recordAgentEvent({ orderType, orderId, agentId: agent.id, eventType: 'assigned', actor });

  const cost = await computeOrderCost({ orderType, order });
  const payout = await createPayout({ orderType, orderId, agent, cost });
  return { agent, cost, payout };
}

/**
 * Move an order to a different agent. Only allowed while no money could have
 * left, which is until the payout is released. An admin can pick any active
 * agent, including one outside the state.
 */
export async function reassignOrder({ orderType, orderId, agentId, note = null, actor = 'admin' }) {
  const supabase = getSupabaseAdmin();

  const order = await loadOrder({ orderType, orderId });
  if (!order) return { error: 'order_not_found' };
  if (!order.assigned_agent_id) return { error: 'not_assigned' };
  if (order.assigned_agent_id === agentId) return { error: 'same_agent' };
  if (isOrderOnHold({ orderType, order })) return { error: 'order_on_hold' };
  if (isOrderCancelled({ orderType, order })) return { error: 'order_cancelled' };

  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, account_number, bank_code, account_name, status')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) return { error: 'agent_not_found' };
  if (agent.status !== 'active') return { error: 'agent_inactive' };

  const orderColumn = orderType === 'regular' ? 'regular_order_id' : 'guest_order_id';
  const { data: payouts, error: payoutsError } = await supabase
    .from('agent_payouts')
    .select('id, status')
    .eq('order_type', orderType)
    .eq(orderColumn, orderId);
  if (payoutsError) return { error: 'payouts_unavailable' };

  const rows = payouts || [];
  if (rows.some((p) => ['processing', 'success'].includes(p.status))) {
    return { error: 'payout_already_sent' };
  }

  const { data: moved, error: moveError } = await supabase
    .from(ORDER_TABLES[orderType])
    .update({ assigned_agent_id: agent.id, agent_work_status: 'assigned', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('assigned_agent_id', order.assigned_agent_id)
    .select('id')
    .maybeSingle();
  if (moveError) {
    logError('[AgentPipeline] Failed to reassign', { orderType, orderId, error: moveError.message });
    return { error: 'reassign_failed' };
  }
  if (!moved) return { error: 'assignment_race' };

  await cancelPayouts(rows.map((p) => p.id));
  await recordAgentEvent({ orderType, orderId, agentId: agent.id, eventType: 'reassigned', note, actor });

  const cost = await computeOrderCost({ orderType, order });
  const payout = await createPayout({ orderType, orderId, agent, cost });
  logInfo('[AgentPipeline] Order reassigned', { orderType, orderId, from: order.assigned_agent_id, to: agent.id, actor });
  return { agent, cost, payout };
}

/**
 * The order was cancelled, so its agent has nothing left to do. If nothing was
 * sent, the payout is cancelled and the order leaves the agent's list. If the
 * agent has been paid, or a payment may be on its way, that is a real debt to
 * sort out, so the record stays and the operator is told.
 *
 * Never throws: the cancellation has already happened.
 */
export async function releaseAgentFromCancelledOrder({ orderType, orderId, actor = 'admin' }) {
  try {
    const supabase = getSupabaseAdmin();
    const order = await loadOrder({ orderType, orderId });
    if (!order?.assigned_agent_id) return { skipped: 'no_agent' };

    const orderColumn = orderType === 'regular' ? 'regular_order_id' : 'guest_order_id';
    const { data: payouts, error } = await supabase
      .from('agent_payouts')
      .select('*')
      .eq('order_type', orderType)
      .eq(orderColumn, orderId);
    if (error) throw error;

    const rows = payouts || [];
    const sent = rows.find((p) => ['processing', 'success'].includes(p.status));
    if (sent) {
      await recordAgentEvent({ orderType, orderId, agentId: order.assigned_agent_id, eventType: 'cancelled', actor, note: 'Agent has been paid, or a payment is on its way.' });
      await sendPayoutAlert({ kind: 'cancelled_paid', payout: sent });
      logInfo('[AgentPipeline] Cancelled order keeps its agent, payment already sent', { orderType, orderId, payoutId: sent.id });
      return { skipped: 'payment_sent' };
    }

    await cancelPayouts(rows.map((p) => p.id));

    const { error: clearError } = await supabase
      .from(ORDER_TABLES[orderType])
      .update({ assigned_agent_id: null, agent_work_status: null, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (clearError) throw clearError;

    await recordAgentEvent({ orderType, orderId, agentId: order.assigned_agent_id, eventType: 'cancelled', actor });
    logInfo('[AgentPipeline] Agent released from cancelled order', { orderType, orderId, agentId: order.assigned_agent_id, actor });
    return { released: true };
  } catch (err) {
    logError('[AgentPipeline] Failed to release agent from cancelled order', { orderType, orderId, error: err.message });
    return { error: err.message };
  }
}
