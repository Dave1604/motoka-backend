import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import { createTransfer, verifyTransfer, payoutsEnabled, autoPayoutLimitKobo } from './monipayTransfer.service.js';
import { sendPayoutAlert } from './agentAlert.service.js';
import { computeOrderCost } from './agentCost.service.js';
import { ORDER_TABLES, isOrderCancelled, isOrderOnHold, orderRefColumns } from './agentWork.service.js';

/**
 * THE LEDGER.
 *
 * One row per assignment in agent_payouts. This module owns every transition.
 * Two rules, both worth stating plainly because they are what make the
 * accounting trustworthy:
 *
 * 1. Transitions are forward-only (pending -> processing -> success). The one
 *    exception is processing -> failed, for a transfer that never settled.
 *    Nothing moves back to pending; a retry is a NEW row, so the dead attempt
 *    stays visible instead of being overwritten.
 *
 * 2. A live payout is unique per order, enforced by a partial unique index in
 *    migration 107. Two concurrent webhooks for the same order cannot both pay
 *    an agent — the second insert loses the race and is discarded. That guard
 *    lives in the database on purpose: application-level checks have races, and
 *    this is the one place where a race costs real money.
 */

const LIVE = ['pending', 'processing', 'success'];

/**
 * Create the payout for a freshly assigned order, then attempt the transfer.
 *
 * Never throws. Returns the payout row (or null if there is nothing to pay),
 * because this runs inside the payment webhook path — a payout failure must not
 * fail the customer's payment.
 */
export async function createPayout({ orderType, orderId, agent, cost }) {
  const supabase = getSupabaseAdmin();
  const amountKobo = cost.totalKobo;
  const missing = cost.missing || [];

  if (!agent) {
    logError('[AgentPayout] No active agent available', { orderType, orderId });
    return null;
  }

  // Nothing to pay (fully complimentary order) — still record the assignment so
  // the operator can see the order was worked, with a zero amount.
  const withholdReason = withholdReasonFor({ amountKobo, missing, profitKobo: cost.profitKobo });

  const { data: payout, error } = await supabase
    .from('agent_payouts')
    .insert({
      ...orderRefColumns({ orderType, orderId }),
      agent_id: agent.id,
      ...costColumns(cost),
      status: withholdReason ? 'manual_review' : 'pending',
      provider: 'monipay',
      failure_reason: withholdReason,
    })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique violation — a live payout already exists for this order.
    // Expected under concurrent webhooks; not an error worth alerting on.
    if (error.code === '23505') {
      logInfo('[AgentPayout] Live payout already exists, skipping', { orderType, orderId });
      return null;
    }
    logError('[AgentPayout] Failed to create payout', { error: error.message, orderType, orderId });
    return null;
  }

  logInfo('[AgentPayout] Created', {
    payoutId: payout.id,
    orderType,
    orderId,
    agentId: agent.id,
    amountKobo,
    withheld: Boolean(withholdReason),
  });

  if (withholdReason) {
    await sendPayoutAlert({ kind: 'manual_review', payout, agent, cost });
    return payout;
  }

  return attemptTransfer(payout, agent);
}

/** The cost and profit figures saved on a payout row. */
function costColumns(cost) {
  return {
    amount_kobo: cost.totalKobo,
    missing_costs: cost.missing || [],
    state: cost.state ?? null,
    customer_amount_kobo: cost.customerAmountKobo ?? null,
    profit_kobo: cost.profitKobo ?? null,
    breakdown: cost.costs || [],
  };
}

export function withholdReasonFor({ amountKobo, missing, profitKobo = null }) {
  if (missing.length > 0) {
    return `missing_costs:${missing.map((m) => `${m.service_type}:${m.service_key}`).join(',')}`;
  }
  if (amountKobo <= 0) return 'zero_amount';
  // Paying this would cost Motoka money, so a person looks at it first.
  if (profitKobo !== null && profitKobo <= 0) return `no_profit:${profitKobo}`;
  if (amountKobo > autoPayoutLimitKobo()) {
    return `over_limit:${amountKobo}>${autoPayoutLimitKobo()}`;
  }
  if (!payoutsEnabled()) return 'payouts_disabled';
  return null;
}

/**
 * Fire the transfer for a pending payout and move it to processing.
 */
export async function attemptTransfer(payout, agent) {
  if (!agent.account_number || !agent.bank_code) {
    return markManualReview(payout, 'agent_missing_bank_details');
  }

  try {
    const result = await createTransfer({
      reference: payout.id,
      amountKobo: payout.amount_kobo,
      recipient: {
        account_number: agent.account_number,
        bank_code: agent.bank_code,
        account_name: agent.account_name,
      },
      narration: `Motoka agent payout ${payout.order_type === 'regular' ? `ORD-${payout.regular_order_id}` : `GUEST-${payout.guest_order_id}`}`,
    });

    if (!result.ok) {
      if (result.failureReason === 'payouts_disabled') {
        return markManualReview(payout, 'payouts_disabled');
      }
      return markFailed(payout, result.failureReason, result.raw);
    }

    const { data: updated, error } = await getSupabaseAdmin()
      .from('agent_payouts')
      .update({
        status: 'processing',
        provider_reference: result.reference,
        provider_response: result.raw,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payout.id)
      .eq('status', 'pending')
      .select('*')
      .single();

    if (error || !updated) {
      // Lost the race to a concurrent transition — leave the winner alone.
      logInfo('[AgentPayout] Transition race, leaving winner', { payoutId: payout.id });
      return payout;
    }
    return updated;
  } catch (err) {
    logError('[AgentPayout] Transfer threw', { payoutId: payout.id, error: err.message });
    return markFailed(payout, err.code || err.message, { error: err.message });
  }
}

/** Move a payout to success. Idempotent. */
export async function markSuccess({ providerReference, raw }) {
  const supabase = getSupabaseAdmin();
  const { data: payout, error } = await supabase
    .from('agent_payouts')
    .update({
      status: 'success',
      paid_at: new Date().toISOString(),
      provider_response: raw,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('provider_reference', providerReference)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();

  if (error) {
    logError('[AgentPayout] markSuccess failed', { providerReference, error: error.message });
    return null;
  }
  if (payout) {
    logInfo('[AgentPayout] Settled', { payoutId: payout.id, providerReference });
  }
  return payout;
}

/** Move a processing payout to failed and alert. */
export async function markFailed(payout, reason, raw) {
  const supabase = getSupabaseAdmin();
  const { data: updated } = await supabase
    .from('agent_payouts')
    .update({
      status: 'failed',
      failure_reason: reason,
      provider_response: raw,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payout.id)
    .in('status', ['pending', 'processing'])
    .select('*')
    .maybeSingle();

  if (updated) {
    logError('[AgentPayout] Failed', { payoutId: payout.id, reason });
    await sendPayoutAlert({ kind: 'failed', payout: updated });
  }
  return updated || payout;
}

/**
 * Provider-reported failure, keyed by the provider reference the webhook sent.
 * Used by the webhook path where we do not have the row loaded.
 */
export async function markFailedByReference({ providerReference, reason, raw }) {
  if (!providerReference) return null;
  const supabase = getSupabaseAdmin();
  const { data: updated } = await supabase
    .from('agent_payouts')
    .update({
      status: 'failed',
      failure_reason: reason || 'provider_reported_failed',
      provider_response: raw,
      updated_at: new Date().toISOString(),
    })
    .eq('provider_reference', providerReference)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();

  if (updated) {
    logError('[AgentPayout] Failed (provider)', { providerReference, reason });
    await sendPayoutAlert({ kind: 'failed', payout: updated });
  }
  return updated;
}

async function markManualReview(payout, reason) {
  const supabase = getSupabaseAdmin();
  const { data: updated } = await supabase
    .from('agent_payouts')
    .update({ status: 'manual_review', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', payout.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  const row = updated || payout;
  if (updated) {
    await sendPayoutAlert({ kind: 'manual_review', payout: row });
  }
  return row;
}

/**
 * Operator action: retry a failed or held payout. Creates a NEW row and cancels
 * the old one, which keeps its failure reason. Cost and profit are worked out
 * again, because the usual reason for a retry is that a missing cost has since
 * been set, and the old row's total would underpay the agent.
 */
export async function retryPayout(payoutId) {
  const supabase = getSupabaseAdmin();
  const { data: old } = await supabase.from('agent_payouts').select('*, agents(*)').eq('id', payoutId).single();
  if (!old) return { error: 'not_found' };
  if (!['failed', 'manual_review'].includes(old.status)) {
    return { error: `cannot_retry_${old.status}` };
  }

  const agent = old.agents;
  if (!agent || agent.status !== 'active') return { error: 'agent_inactive' };

  const orderId = old.order_type === 'regular' ? old.regular_order_id : old.guest_order_id;
  const { data: order } = await supabase.from(ORDER_TABLES[old.order_type]).select('*').eq('id', orderId).maybeSingle();
  if (!order) return { error: 'order_not_found' };
  if (isOrderOnHold({ orderType: old.order_type, order })) return { error: 'order_on_hold' };
  if (isOrderCancelled({ orderType: old.order_type, order })) return { error: 'order_cancelled' };

  const cost = await computeOrderCost({ orderType: old.order_type, order });
  const withholdReason = withholdReasonFor({
    amountKobo: cost.totalKobo,
    missing: cost.missing,
    profitKobo: cost.profitKobo,
  });

  const { data: fresh, error } = await supabase
    .from('agent_payouts')
    .insert({
      ...orderRefColumns({ orderType: old.order_type, orderId }),
      agent_id: old.agent_id,
      ...costColumns(cost),
      status: withholdReason ? 'manual_review' : 'pending',
      provider: old.provider,
      failure_reason: withholdReason,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return { error: 'live_payout_exists' };
    return { error: error.message };
  }

  await cancelPayouts([old.id]);

  if (withholdReason) return { payout: fresh };
  const payout = await attemptTransfer(fresh, agent);
  return { payout };
}

/**
 * Retire rows nothing was sent for. Only failed and held rows qualify, so a row
 * that reached the provider or was already paid can never be cancelled.
 */
export async function cancelPayouts(payoutIds) {
  if (payoutIds.length === 0) return;
  const { error } = await getSupabaseAdmin()
    .from('agent_payouts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', payoutIds)
    .in('status', ['failed', 'manual_review']);
  if (error) logError('[AgentPayout] Failed to cancel payouts', { payoutIds, error: error.message });
}

/**
 * Operator action: record a payment made outside the system (bank app, cash).
 * The ledger must be able to represent reality, not just what the API did —
 * otherwise the operator quietly keeps a shadow spreadsheet and we are back
 * where we started.
 */
export async function markPaidManually(payoutId, note) {
  const supabase = getSupabaseAdmin();

  // The total on this row leaves out the missing items, so recording it as paid
  // would make the ledger say the order is settled when it is not.
  const { data: current } = await supabase.from('agent_payouts').select('missing_costs').eq('id', payoutId).maybeSingle();
  if ((current?.missing_costs || []).length > 0) {
    return { error: 'This order has missing costs. Set them, then click Retry to refresh the amount.' };
  }

  const { data: payout, error } = await supabase
    .from('agent_payouts')
    .update({
      status: 'success',
      provider: 'manual',
      paid_at: new Date().toISOString(),
      failure_reason: null,
      provider_response: { manual: true, note: note || null, by: 'admin' },
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .in('status', ['failed', 'manual_review', 'pending', 'processing'])
    .select('*')
    .maybeSingle();

  if (error) {
    logError('[AgentPayout] markPaidManually failed', { payoutId, error: error.message });
    return { error: error.message };
  }
  if (!payout) return { error: 'not_found_or_final' };
  logInfo('[AgentPayout] Marked paid manually', { payoutId, note });
  return { payout };
}

/**
 * Confirm a processing payout by asking the provider. Used by the admin
 * "check status" action when a webhook may have been missed.
 */
export async function reconcilePayout(payoutId) {
  const supabase = getSupabaseAdmin();
  const { data: payout } = await supabase.from('agent_payouts').select('*').eq('id', payoutId).single();
  if (!payout || payout.status !== 'processing' || !payout.provider_reference) {
    return { error: 'not_reconcilable' };
  }

  const result = await verifyTransfer(payout.provider_reference);
  if (result.ok) {
    const settled = await markSuccess({ providerReference: payout.provider_reference, raw: result.raw });
    return { payout: settled };
  }
  if (result.status === 'failed') {
    const failed = await markFailed(payout, 'provider_reported_failed', result.raw);
    return { payout: failed };
  }
  return { error: `provider_status:${result.status}` };
}

export { LIVE };
