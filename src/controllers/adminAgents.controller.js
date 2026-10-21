import { getSupabaseAdmin } from '../config/supabase.js';
import * as response from '../utils/responses.js';
import { logError, logInfo } from '../utils/logger.js';
import { retryPayout, markPaidManually, reconcilePayout } from '../services/agents/agentPayout.service.js';
import { assignOrderManually } from '../services/agents/agentPipeline.service.js';
import { autoPayoutLimitKobo, payoutsEnabled } from '../services/agents/monipayTransfer.service.js';

/**
 * ADMIN — AGENT FULFILMENT PIPELINE
 *
 * Three surfaces: the agents themselves, the cost table, and the payout queue.
 * The payout queue is the one that replaces the operator's mental bookkeeping,
 * so it joins agent name and a human order reference rather than raw ids.
 */

// ─── Agents ─────────────────────────────────────────────────────────────────

export async function listAgents(req, res) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return response.serverError(res, 'Failed to load agents');
    return response.success(res, { data });
  } catch (err) {
    logError('[AdminAgents] listAgents error', err);
    return response.serverError(res, 'Failed to load agents');
  }
}

export async function createAgent(req, res) {
  try {
    const { name, phone, email, bank_name, bank_code, account_number, account_name, notes } = req.body || {};
    if (!name || !String(name).trim()) {
      return response.error(res, 'name is required');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agents')
      .insert({
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
    logInfo('[AdminAgents] Agent created', { agentId: data.id, name: data.name, adminId: req.admin?.id });
    return response.created(res, data, 'Agent created');
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

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('agents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) return response.serverError(res, 'Failed to update agent');
    if (!data) return response.notFound(res, 'Agent not found');
    logInfo('[AdminAgents] Agent updated', { agentId: id, fields: Object.keys(patch), adminId: req.admin?.id });
    return response.success(res, data, 'Agent updated');
  } catch (err) {
    logError('[AdminAgents] updateAgent error', err);
    return response.serverError(res, 'Failed to update agent');
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
      .order('service_key', { ascending: true });

    if (error) return response.serverError(res, 'Failed to load cost table');
    return response.success(res, { data });
  } catch (err) {
    logError('[AdminAgents] listAgentCosts error', err);
    return response.serverError(res, 'Failed to load cost table');
  }
}

export async function upsertAgentCost(req, res) {
  try {
    const { service_type, service_key, cost_kobo, active } = req.body || {};
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
          cost_kobo: cost,
          ...(active !== undefined ? { active: Boolean(active) } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'service_type,service_key' }
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

  try {
    if (payout.order_type === 'regular' && payout.regular_order_id) {
      const { data } = await supabase
        .from('renewal_orders')
        .select('order_number, status')
        .eq('id', payout.regular_order_id)
        .maybeSingle();
      order_reference = data?.order_number || `#${payout.regular_order_id}`;
      order_status = data?.status || null;
    } else if (payout.order_type === 'guest' && payout.guest_order_id) {
      const { data } = await supabase
        .from('guest_renewal_orders')
        .select('id, payment_status, fulfillment_status, plate_number')
        .eq('id', payout.guest_order_id)
        .maybeSingle();
      order_reference = data?.plate_number ? `Guest · ${data.plate_number}` : `Guest · ${String(payout.guest_order_id).slice(0, 8)}`;
      order_status = data?.fulfillment_status || data?.payment_status || null;
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

    const result = await assignOrderManually({ orderType: order_type, orderId: order_id, agentId: agent_id });
    if (result.error) return response.error(res, result.error);
    logInfo('[AdminAgents] Agent assigned manually', { orderType: order_type, orderId: order_id, agentId: agent_id, adminId: req.admin?.id });
    return response.success(res, { agent: result.agent, cost: result.cost, payout: result.payout }, 'Agent assigned');
  } catch (err) {
    logError('[AdminAgents] assignAgentToOrder error', err);
    return response.serverError(res, 'Failed to assign agent');
  }
}
