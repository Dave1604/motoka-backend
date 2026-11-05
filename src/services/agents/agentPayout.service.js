import { getSupabaseAdmin } from '../../config/supabase.js';
import { logError, logInfo } from '../../utils/logger.js';
import {
  autoPayoutLimitKobo,
  bankChangeCooldownMs,
  createTransfer,
  createTransferRecipient,
  dailyPayoutLimitKobo,
  findTransferForPayout,
  payoutsEnabled,
  verifyTransfer,
} from './monipayTransfer.service.js';
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
 *    stays visible instead of being overwritten. `pending` means ready to release:
 *    money only moves when an admin releases it (see releasePayout).
 *
 * 2. A live payout is unique per order, enforced by a partial unique index in
 *    migration 107. Two concurrent webhooks for the same order cannot both pay
 *    an agent — the second insert loses the race and is discarded. That guard
 *    lives in the database on purpose: application-level checks have races, and
 *    this is the one place where a race costs real money.
 */

const LIVE = ['pending', 'processing', 'success'];

/**
 * Create the payout for a freshly assigned order. It waits for an admin to
 * release it, and no money moves here.
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
  }
  return payout;
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
  return null;
}

// ─── Releasing a payment ────────────────────────────────────────────────────

const WAT_OFFSET_MS = 60 * 60 * 1000;

function startOfTodayNigeria() {
  const now = new Date(Date.now() + WAT_OFFSET_MS);
  now.setUTCHours(0, 0, 0, 0);
  return new Date(now.getTime() - WAT_OFFSET_MS).toISOString();
}

async function releasedTodayKobo() {
  const { data, error } = await getSupabaseAdmin()
    .from('agent_payouts')
    .select('amount_kobo')
    .in('status', ['processing', 'success'])
    .gte('released_at', startOfTodayNigeria());
  if (error) throw error;
  return (data || []).reduce((sum, row) => sum + (Number(row.amount_kobo) || 0), 0);
}

async function loadPayoutForRelease(payoutId) {
  const supabase = getSupabaseAdmin();
  const { data: payout } = await supabase.from('agent_payouts').select('*, agents(*)').eq('id', payoutId).maybeSingle();
  if (!payout) return null;

  const orderId = payout.order_type === 'regular' ? payout.regular_order_id : payout.guest_order_id;
  const { data: order } = await supabase.from(ORDER_TABLES[payout.order_type]).select('*').eq('id', orderId).maybeSingle();
  return { payout, agent: payout.agents, order };
}

/** How the customer's payment stands, from the order or its transaction. */
async function customerPayment({ payout, order }) {
  if (payout.order_type === 'guest') {
    return { gateway: order?.payment_gateway || null, paid: order?.payment_status === 'payment_success' };
  }
  if (!order?.transaction_id) return { gateway: null, paid: false };
  const { data } = await getSupabaseAdmin()
    .from('payment_transactions')
    .select('payment_gateway, status')
    .eq('id', order.transaction_id)
    .maybeSingle();
  return { gateway: data?.payment_gateway || null, paid: data?.status === 'successful' };
}

/** Everything that stops a release, in plain words for the admin. */
async function releaseBlockers({ payout, agent, order }) {
  const blockers = [];
  const amount = Number(payout.amount_kobo);

  if (!payoutsEnabled()) blockers.push('Monipay payments are switched off (AGENT_PAYOUTS_ENABLED).');
  if (payout.status !== 'pending') blockers.push(`This payout is ${String(payout.status).replace('_', ' ')}, not ready to release.`);
  if (!agent || agent.status !== 'active') blockers.push('This agent is not active.');
  if (!agent?.account_number || !agent?.bank_code) blockers.push('This agent has no bank details. Edit the agent to add them.');
  if (!order) blockers.push('The order could not be found.');
  if (order && order.assigned_agent_id !== payout.agent_id) blockers.push('This order now belongs to a different agent.');
  if (order && !(await customerPayment({ payout, order })).paid) blockers.push('The customer payment on this order is not successful.');
  if (order && isOrderOnHold({ orderType: payout.order_type, order })) blockers.push('This order is on hold until its renewal window opens.');
  if (order && isOrderCancelled({ orderType: payout.order_type, order })) blockers.push('This order is cancelled.');
  if ((payout.missing_costs || []).length > 0) blockers.push('This order has missing costs. Set them, then click Retry.');
  if (!Number.isInteger(amount) || amount <= 0) blockers.push('The agent cost is not a valid amount.');
  if (payout.profit_kobo === null || payout.profit_kobo === undefined || Number(payout.profit_kobo) <= 0) {
    blockers.push('This payment would leave Motoka no profit.');
  } else if (Number(payout.customer_amount_kobo) - amount !== Number(payout.profit_kobo)) {
    blockers.push('The figures on this payout do not add up. Click Retry to work them out again.');
  }

  const changedAt = agent?.bank_changed_at ? new Date(agent.bank_changed_at).getTime() : null;
  if (changedAt !== null) {
    const remainingMs = changedAt + bankChangeCooldownMs() - Date.now();
    if (remainingMs > 0) {
      blockers.push(`This agent's bank details were just set or changed. Payments open in ${Math.ceil(remainingMs / 3600000)} hour(s).`);
    }
  }
  if (amount > autoPayoutLimitKobo()) blockers.push('This is above the limit for one transfer.');

  if (blockers.length === 0 && (await releasedTodayKobo()) + amount > dailyPayoutLimitKobo()) {
    blockers.push("This would go over today's payment limit.");
  }
  return blockers;
}

/** What the admin confirms in the release dialog. */
export async function getReleasePreview(payoutId) {
  const loaded = await loadPayoutForRelease(payoutId);
  if (!loaded) return { error: 'Payout not found' };
  const { payout, agent, order } = loaded;

  const warnings = [];
  if (order && (order.agent_work_status || 'assigned') === 'assigned') {
    warnings.push('The agent has not started this work yet.');
  }
  const { gateway } = await customerPayment({ payout, order });
  if (gateway && gateway !== 'monipay') {
    warnings.push(`The customer paid by ${gateway}, so this money may not be in your Monipay balance.`);
  }

  return {
    preview: {
      id: payout.id,
      status: payout.status,
      amount_kobo: payout.amount_kobo,
      customer_amount_kobo: payout.customer_amount_kobo,
      profit_kobo: payout.profit_kobo,
      state: payout.state,
      agent_name: agent?.name || null,
      account_name: agent?.account_name || null,
      bank_name: agent?.bank_name || null,
      account_number: agent?.account_number || null,
      order_reference: order?.order_number || order?.plate_number || null,
      blockers: await releaseBlockers({ payout, agent, order }),
      warnings,
    },
  };
}

/** Same person if every word of the shorter name appears in the longer one, in any order. */
export function accountNamesMatch(a, b) {
  const words = (name) => String(name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const [shorter, longer] = [words(a), words(b)].sort((x, y) => x.length - y.length);
  return shorter.length > 0 && shorter.every((word) => longer.includes(word));
}

async function ensureRecipient(agent) {
  if (agent.monipay_recipient_code) return { recipientCode: agent.monipay_recipient_code };

  const result = await createTransferRecipient({
    name: agent.account_name || agent.name,
    accountNumber: agent.account_number,
    bankCode: agent.bank_code,
  });
  if (!result.ok) return { error: result.reason };

  if (agent.account_name && result.accountName && !accountNamesMatch(agent.account_name, result.accountName)) {
    return { error: `The bank has this account as "${result.accountName}", not "${agent.account_name}". Check the agent's details.` };
  }

  const { error } = await getSupabaseAdmin()
    .from('agents')
    .update({ monipay_recipient_code: result.recipientCode, updated_at: new Date().toISOString() })
    .eq('id', agent.id);
  if (error) logError('[AgentPayout] Failed to save recipient code', { agentId: agent.id, error: error.message });
  return { recipientCode: result.recipientCode };
}

/**
 * Admin action: send the agent their money. The row is claimed before the transfer
 * starts, so a double-click or a second admin finds it already taken and cannot
 * send it twice.
 */
export async function releasePayout({ payoutId, actor }) {
  const loaded = await loadPayoutForRelease(payoutId);
  if (!loaded) return { error: 'Payout not found' };
  const { payout, agent, order } = loaded;

  const blockers = await releaseBlockers({ payout, agent, order });
  if (blockers.length > 0) return { error: blockers[0] };

  const recipient = await ensureRecipient(agent);
  if (recipient.error) return { error: recipient.error };

  const supabase = getSupabaseAdmin();
  const { data: claimed, error: claimError } = await supabase
    .from('agent_payouts')
    .update({
      status: 'processing',
      released_at: new Date().toISOString(),
      released_by: actor,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payout.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (claimError) {
    logError('[AgentPayout] Failed to claim payout', { payoutId, error: claimError.message });
    return { error: 'Could not start this payment. No money moved.' };
  }
  if (!claimed) return { error: 'This payment was already released.' };

  // Checked again now this claim is counted, so releases at the same moment cannot
  // pass the limit together. If that race happens, all of them back off.
  if ((await releasedTodayKobo()) > dailyPayoutLimitKobo()) {
    await supabase
      .from('agent_payouts')
      .update({ status: 'pending', released_at: null, released_by: null, updated_at: new Date().toISOString() })
      .eq('id', payout.id)
      .eq('status', 'processing');
    return { error: "This would go over today's payment limit. No money moved." };
  }

  logInfo('[AgentPayout] Released', { payoutId, actor, amountKobo: payout.amount_kobo });

  const result = await createTransfer({
    reference: payout.id,
    amountKobo: payout.amount_kobo,
    recipientCode: recipient.recipientCode,
  });

  if (result.outcome === 'rejected') {
    const failed = await markFailed(claimed, result.reason, result.raw);
    return { error: `Monipay refused this payment: ${result.reason}. No money moved.`, payout: failed };
  }

  if (result.outcome === 'unknown') {
    // Stay in processing. Money may have moved, so this must not be retried until
    // Monipay confirms what happened. See reconcilePayout.
    const { data: unconfirmed } = await supabase
      .from('agent_payouts')
      .update({ failure_reason: `unconfirmed: ${result.reason}`, provider_response: result.raw, updated_at: new Date().toISOString() })
      .eq('id', payout.id)
      .eq('status', 'processing')
      .select('*')
      .maybeSingle();
    return { payout: unconfirmed || claimed, unconfirmed: true };
  }

  const { data: updated } = await supabase
    .from('agent_payouts')
    .update({ provider_reference: result.transferCode, provider_response: result.raw, updated_at: new Date().toISOString() })
    .eq('id', payout.id)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();

  if (result.status === 'success') {
    const settled = await markSuccess({ references: [result.transferCode], raw: result.raw, amountKobo: result.amountKobo });
    return { payout: settled || updated };
  }
  return { payout: updated || claimed };
}

// ─── Monipay's answer ───────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A webhook can name a transfer by its code or by the payout id we sent as its reference. */
async function findPayoutByReferences(references, statuses) {
  const supabase = getSupabaseAdmin();
  for (const reference of references) {
    const { data } = await supabase
      .from('agent_payouts')
      .select('*')
      .eq('provider_reference', reference)
      .in('status', statuses)
      .maybeSingle();
    if (data) return data;
    if (UUID.test(reference)) {
      const { data: byId } = await supabase
        .from('agent_payouts')
        .select('*')
        .eq('id', reference)
        .in('status', statuses)
        .maybeSingle();
      if (byId) return byId;
    }
  }
  return null;
}

/** Move a payout to success. Idempotent. */
export async function markSuccess({ references, raw, amountKobo = null }) {
  const payout = await findPayoutByReferences(references, ['processing']);
  if (!payout) return null;

  // A different amount needs a person. Do not record it as settled.
  if (amountKobo !== null && Number(amountKobo) !== Number(payout.amount_kobo)) {
    const reason = `Amount mismatch: Monipay reports ${amountKobo}, released ${payout.amount_kobo} (kobo)`;
    logError('[AgentPayout] Amount mismatch', { payoutId: payout.id, amountKobo, expected: payout.amount_kobo });
    if (payout.failure_reason !== reason) {
      const { data: flagged } = await getSupabaseAdmin()
        .from('agent_payouts')
        .update({ failure_reason: reason, provider_response: raw, updated_at: new Date().toISOString() })
        .eq('id', payout.id)
        .eq('status', 'processing')
        .select('*')
        .maybeSingle();
      await sendPayoutAlert({ kind: 'amount_mismatch', payout: flagged || payout });
    }
    return null;
  }

  const { data: settled, error } = await getSupabaseAdmin()
    .from('agent_payouts')
    .update({
      status: 'success',
      paid_at: new Date().toISOString(),
      provider_response: raw,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payout.id)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();

  if (error) {
    logError('[AgentPayout] markSuccess failed', { payoutId: payout.id, error: error.message });
    return null;
  }
  if (settled) logInfo('[AgentPayout] Settled', { payoutId: payout.id });
  return settled;
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
 * Failure reported by Monipay's webhook. A reversal can arrive after a transfer
 * succeeded, so it can also undo a success: the money came back.
 */
export async function markFailedByReference({ references, reason, raw, reversed = false }) {
  const payout = await findPayoutByReferences(references, reversed ? ['processing', 'success'] : ['processing']);
  if (!payout) return null;

  const { data: updated } = await getSupabaseAdmin()
    .from('agent_payouts')
    .update({
      status: 'failed',
      failure_reason: reason || 'provider_reported_failed',
      paid_at: null,
      provider_response: raw,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payout.id)
    .eq('status', payout.status)
    .select('*')
    .maybeSingle();

  if (updated) {
    logError('[AgentPayout] Failed (provider)', { payoutId: payout.id, reason });
    await sendPayoutAlert({ kind: 'failed', payout: updated });
  }
  return updated;
}

/**
 * Operator action: retry a failed or held payout. Creates a NEW row, ready to
 * release, and cancels the old one, which keeps its failure reason. Cost and profit
 * are worked out again, because the usual reason for a retry is that a missing cost
 * has since been set, and the old row's total would underpay the agent.
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

  return { payout: fresh };
}

/**
 * Retire rows nothing was sent for. A row that reached the provider or was already
 * paid can never be cancelled.
 */
export async function cancelPayouts(payoutIds) {
  if (payoutIds.length === 0) return;
  const { error } = await getSupabaseAdmin()
    .from('agent_payouts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', payoutIds)
    .in('status', ['pending', 'failed', 'manual_review']);
  if (error) logError('[AgentPayout] Failed to cancel payouts', { payoutIds, error: error.message });
}

/**
 * Operator action: record a payment made outside the system (bank app, cash).
 * The ledger must be able to represent reality, not just what the API did —
 * otherwise the operator quietly keeps a shadow spreadsheet and we are back
 * where we started.
 */
export async function markPaidManually({ payoutId, note, actor }) {
  const supabase = getSupabaseAdmin();

  const { data: current } = await supabase.from('agent_payouts').select('missing_costs, status').eq('id', payoutId).maybeSingle();
  if (!current) return { error: 'Payout not found' };

  // The total on this row leaves out the missing items, so recording it as paid
  // would make the ledger say the order is settled when it is not.
  if ((current.missing_costs || []).length > 0) {
    return { error: 'This order has missing costs. Set them, then click Retry to refresh the amount.' };
  }

  // A transfer is on its way. Recording another payment here could pay the agent
  // twice, so it needs proof that the money arrived.
  if (current.status === 'processing' && !String(note || '').trim()) {
    return { error: 'This payment is being sent through Monipay. Say what you saw on the Monipay dashboard before marking it paid.' };
  }

  const { data: payout, error } = await supabase
    .from('agent_payouts')
    .update({
      status: 'success',
      provider: 'manual',
      paid_at: new Date().toISOString(),
      failure_reason: null,
      provider_response: { manual: true, note: note || null, by: actor },
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .in('status', ['failed', 'manual_review', 'pending', 'processing'])
    .select('*')
    .maybeSingle();

  if (error) {
    logError('[AgentPayout] markPaidManually failed', { payoutId, error: error.message });
    return { error: 'Could not record this payment.' };
  }
  if (!payout) return { error: 'This payout can no longer be changed.' };
  logInfo('[AgentPayout] Marked paid manually', { payoutId, actor });
  return { payout };
}

/**
 * Admin action, after checking the Monipay dashboard: record that an unconfirmed
 * transfer never went through, so it can be retried. Getting this wrong pays the
 * agent twice, so a note is required.
 */
export async function markUnconfirmedFailed({ payoutId, note, actor }) {
  if (!note || !String(note).trim()) return { error: 'Say what you saw on the Monipay dashboard.' };

  const { data: payout, error } = await getSupabaseAdmin()
    .from('agent_payouts')
    .update({
      status: 'failed',
      failure_reason: `Marked failed by ${actor}: ${String(note).trim()}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();

  if (error) return { error: 'Could not update this payout.' };
  if (!payout) return { error: 'This payout is no longer being processed.' };
  logInfo('[AgentPayout] Unconfirmed transfer marked failed', { payoutId, actor });
  return { payout };
}

/**
 * Confirm a processing payout by asking the provider. Used by the admin "check
 * status" action and the background sweep, for when a webhook was missed.
 */
export async function reconcilePayout(payoutId) {
  const supabase = getSupabaseAdmin();
  const { data: payout } = await supabase.from('agent_payouts').select('*').eq('id', payoutId).maybeSingle();
  if (!payout || payout.status !== 'processing') return { error: 'This payout is not being processed.' };

  let transferCode = payout.provider_reference;
  if (!transferCode) {
    const found = await findTransferForPayout(payout.id);
    if (!found) return { error: 'Monipay has no transfer for this payout yet. Check the Monipay dashboard before doing anything else.' };
    transferCode = found.transferCode;
    await supabase.from('agent_payouts').update({ provider_reference: transferCode }).eq('id', payout.id).eq('status', 'processing');
  }

  const result = await verifyTransfer(transferCode);
  if (result.state === 'success') {
    const settled = await markSuccess({ references: [transferCode], raw: result.raw, amountKobo: result.amountKobo });
    return settled ? { payout: settled } : { error: 'Monipay reports a different amount from what was released. Check the Monipay dashboard.' };
  }
  if (result.state === 'failed') {
    return { payout: await markFailedByReference({ references: [transferCode], reason: 'Monipay reported this transfer failed', raw: result.raw }) };
  }
  return { error: result.state === 'pending' ? 'Monipay is still processing this transfer.' : 'Could not get an answer from Monipay. Try again shortly.' };
}

const STUCK_AFTER_MS = 10 * 60 * 1000;
const ALERT_AFTER_MS = 60 * 60 * 1000;
const STUCK_MARKER = 'still unconfirmed';

/**
 * Background sweep for transfers with no answer yet. Never marks one failed on its
 * own: if Monipay cannot say, the admin is told once and the row stays put.
 */
export async function reconcileProcessingPayouts() {
  if (!payoutsEnabled()) return;

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('agent_payouts')
    .select('id, released_at, failure_reason, order_type, regular_order_id, guest_order_id, agent_id, amount_kobo')
    .eq('status', 'processing')
    .lte('released_at', new Date(Date.now() - STUCK_AFTER_MS).toISOString())
    .limit(20);
  if (error) {
    logError('[AgentPayout] Sweep query failed', { error: error.message });
    return;
  }

  for (const row of rows || []) {
    const result = await reconcilePayout(row.id);
    const old = Date.now() - new Date(row.released_at).getTime() > ALERT_AFTER_MS;
    if (result.error && old && !String(row.failure_reason || '').startsWith(STUCK_MARKER)) {
      const failureReason = `${STUCK_MARKER}: ${result.error}`;
      await supabase.from('agent_payouts').update({ failure_reason: failureReason }).eq('id', row.id).eq('status', 'processing');
      await sendPayoutAlert({ kind: 'unconfirmed', payout: { ...row, failure_reason: failureReason } });
    }
  }
}

export { LIVE };
