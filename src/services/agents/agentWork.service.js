import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';

/**
 * WORK PROGRESS
 *
 * Who is doing what on a customer's document. This is separate from the order's
 * own status (what the customer sees) and from the payout status (the money):
 * an agent can be paid and still not have submitted anything.
 *
 * Every change writes a row to agent_order_events, so the history survives a
 * reassignment even though the order only stores the current agent.
 */

export const ORDER_TABLES = { regular: 'renewal_orders', guest: 'guest_renewal_orders' };

const TRANSITIONS = {
  assigned: ['in_progress', 'rejected'],
  in_progress: ['submitted', 'rejected'],
  submitted: ['completed', 'in_progress', 'rejected'],
  rejected: ['in_progress'],
  completed: [],
};

/**
 * An order paid before its renewal window opens is held until then. No agent
 * works on it or gets paid for it yet, so it is assigned when it is released.
 */
export function isOrderOnHold({ orderType, order }) {
  return orderType === 'guest' ? Boolean(order.scheduled_for) : order.status === 'scheduled';
}

export function isOrderCancelled({ orderType, order }) {
  return (orderType === 'guest' ? order.fulfillment_status : order.status) === 'cancelled';
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function orderRefColumns({ orderType, orderId }) {
  return {
    order_type: orderType,
    regular_order_id: orderType === 'regular' ? orderId : null,
    guest_order_id: orderType === 'guest' ? orderId : null,
  };
}

/** History is a side effect: failing to write it must not undo the real change. */
export async function recordAgentEvent({ orderType, orderId, agentId, eventType, note = null, actor = 'system' }) {
  try {
    const { error } = await getSupabaseAdmin()
      .from('agent_order_events')
      .insert({ ...orderRefColumns({ orderType, orderId }), agent_id: agentId, event_type: eventType, note, actor });
    if (error) logError('[AgentWork] Failed to record event', { orderType, orderId, eventType, error: error.message });
  } catch (err) {
    logError('[AgentWork] Failed to record event', { orderType, orderId, eventType, error: err.message });
  }
}

export async function setAgentWorkStatus({ orderType, orderId, status, note = null, actor = 'admin' }) {
  const table = ORDER_TABLES[orderType];
  const supabase = getSupabaseAdmin();

  const { data: order, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) return { error: 'order_not_found' };
  if (isOrderCancelled({ orderType, order })) return { error: 'order_cancelled' };
  if (!order.assigned_agent_id) return { error: 'no_agent_assigned' };

  const current = order.agent_work_status || 'assigned';
  if (!canTransition(current, status)) return { error: `cannot_move_${current}_to_${status}` };

  let update = supabase
    .from(table)
    .update({ agent_work_status: status, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  update = order.agent_work_status
    ? update.eq('agent_work_status', order.agent_work_status)
    : update.is('agent_work_status', null);

  const { data: updated, error: updateError } = await update.select('id').maybeSingle();
  if (updateError) {
    logError('[AgentWork] Failed to update status', { orderType, orderId, status, error: updateError.message });
    return { error: 'update_failed' };
  }
  if (!updated) return { error: 'status_changed_retry' };

  await recordAgentEvent({ orderType, orderId, agentId: order.assigned_agent_id, eventType: status, note, actor });
  logInfo('[AgentWork] Status changed', { orderType, orderId, from: current, to: status, actor });
  return { status };
}

/**
 * The order was completed from Order Actions, so the agent's work is over however
 * far its progress had been updated. A rejection is left alone: that agent did
 * not do the work. Never throws, because the order is already complete.
 */
export async function completeAgentWork({ orderType, orderId, actor = 'admin' }) {
  try {
    const supabase = getSupabaseAdmin();
    const table = ORDER_TABLES[orderType];
    const { data: order } = await supabase
      .from(table)
      .select('id, assigned_agent_id, agent_work_status')
      .eq('id', orderId)
      .maybeSingle();

    if (!order?.assigned_agent_id || ['completed', 'rejected'].includes(order.agent_work_status)) return;

    const { error } = await supabase
      .from(table)
      .update({ agent_work_status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;

    await recordAgentEvent({ orderType, orderId, agentId: order.assigned_agent_id, eventType: 'completed', actor });
  } catch (err) {
    logError('[AgentWork] Failed to complete agent work', { orderType, orderId, error: err.message });
  }
}
