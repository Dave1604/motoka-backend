import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import { computeOrderCost } from './agentCost.service.js';
import { createPayout } from './agentPayout.service.js';

/**
 * ASSIGNMENT + PAYOUT ORCHESTRATION
 *
 * Called from the two places a paid order becomes real work:
 *   - payment-success.service.js  (regular renewal_orders, after _startProcessing)
 *   - guestRenewal.service.js     (guest_renewal_orders, after markGuestOrderPaid)
 *
 * Both call sites are inside the customer's payment webhook path, so this
 * module is written to be boring: it never throws, it never blocks the webhook
 * for long, and every failure is logged rather than surfaced. The customer's
 * payment succeeding is the primary event; assigning an agent is a side effect.
 *
 * Order of operations for a paid order:
 *   1. pick an agent (least-recently-assigned active agent)
 *   2. stamp assigned_agent_id on the order so the admin UI can show it
 *   3. compute the cost from the agent cost table
 *   4. create the ledger row and attempt the transfer
 *
 * Steps 1-3 happen even when payouts are disabled, so the ledger is populated
 * and the accounting is correct from day one. Only step 4's network call is
 * gated on AGENT_PAYOUTS_ENABLED.
 */
export async function runAgentPipeline({ orderType, order }) {
  try {
    const orderId = orderType === 'regular' ? order.id : order.id;

    // Already assigned (replay / duplicate webhook)? Do nothing — the unique
    // index would catch a double payout anyway, but cheap check first.
    if (order.assigned_agent_id) {
      logInfo('[AgentPipeline] Already assigned, skipping', { orderType, orderId });
      return { skipped: 'already_assigned' };
    }

    const agent = await pickAgent();
    if (!agent) {
      logInfo('[AgentPipeline] No active agent, order left unassigned', { orderType, orderId });
      return { skipped: 'no_active_agent' };
    }

    const stamped = await stampAssignment({ orderType, orderId, agentId: agent.id });
    if (!stamped) {
      // Someone else won the race to assign it. Leave their work alone.
      return { skipped: 'assignment_race' };
    }

    const cost = await computeOrderCost({ orderType, order });
    const payout = await createPayout({ orderType, orderId, agent, cost });

    return { agent, cost, payout };
  } catch (err) {
    // Never rethrow: this runs inside the payment webhook.
    logError('[AgentPipeline] Failed (non-fatal)', {
      orderType,
      orderId: order?.id,
      error: err.message,
      stack: err.stack,
    });
    return { error: err.message };
  }
}

/**
 * Round-robin: the active agent who was assigned least recently (or never).
 * Implemented as "order by last assignment time ascending" rather than a
 * counter, because a counter has to be incremented atomically and a lookup
 * does not — and with a handful of agents the difference is noise.
 */
async function pickAgent() {
  const supabase = getSupabaseAdmin();

  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, name, account_number, bank_code, account_name, status')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error || !agents || agents.length === 0) {
    if (error) logError('[AgentPipeline] Failed to load agents', { error: error.message });
    return null;
  }

  const { data: recent } = await supabase
    .from('agent_payouts')
    .select('agent_id, assigned_at')
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
  const table = orderType === 'regular' ? 'renewal_orders' : 'guest_renewal_orders';

  const { data, error } = await supabase
    .from(table)
    .update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() })
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
export async function assignOrderManually({ orderType, orderId, agentId }) {
  const supabase = getSupabaseAdmin();

  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, account_number, bank_code, account_name, status')
    .eq('id', agentId)
    .maybeSingle();

  if (!agent) return { error: 'agent_not_found' };
  if (agent.status !== 'active') return { error: 'agent_inactive' };

  const table = orderType === 'regular' ? 'renewal_orders' : 'guest_renewal_orders';
  const { data: order, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) return { error: 'order_not_found' };
  if (order.assigned_agent_id) return { error: 'already_assigned' };

  const stamped = await stampAssignment({ orderType, orderId, agentId: agent.id });
  if (!stamped) return { error: 'assignment_race' };

  const cost = await computeOrderCost({ orderType, order });
  const payout = await createPayout({ orderType, orderId, agent, cost });
  return { agent, cost, payout };
}
