import { logError, logInfo, logWarn } from '../../utils/logger.js';

/**
 * MONEY OUT — agent payouts.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ UNVERIFIED TRANSPORT. The request shapes below are PLACEHOLDERS.         │
 * │ Monipay's transfer API has not been confirmed — their public docs do not │
 * │ publish transfer endpoints, and nothing in this codebase calls one yet.  │
 * │                                                                          │
 * │ Nothing here is reachable while AGENT_PAYOUTS_ENABLED is unset/false,    │
 * │ which is the default. The pipeline still assigns agents and writes the   │
 * │ ledger; it just marks payouts manual_review instead of calling out.      │
 * │                                                                          │
 * │ TODO(monipay): confirm base path, auth, request/response schema, and     │
 * │ whether the account holds float (collections settle to bank in ~1 day —  │
 * │ if there is no wallet balance, transfers cannot originate here and the   │
 * │ provider must change). Then replace createTransfer/verifyTransfer and    │
 * │ delete this banner.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const BASE_URL = () => (process.env.MONIPAY_BASE_URL || 'https://api.monipay.ng').replace(/\/+$/, '');

export function payoutsEnabled() {
  return String(process.env.AGENT_PAYOUTS_ENABLED || '').toLowerCase() === 'true';
}

/** Per-transfer ceiling. Anything above goes to manual review. */
export function autoPayoutLimitKobo() {
  const raw = Number(process.env.AGENT_AUTO_PAYOUT_LIMIT_KOBO || 50000000); // ₦500,000
  return Number.isFinite(raw) && raw > 0 ? raw : 50000000;
}

export function payoutProvider() {
  return String(process.env.AGENT_PAYOUT_PROVIDER || 'monipay').toLowerCase();
}

async function monipayRequest(path, { method = 'POST', body, secret = true } = {}) {
  const key = secret ? process.env.MONIPAY_SECRET_KEY : process.env.MONIPAY_PUBLIC_KEY;
  if (!key) {
    const err = new Error('MONIPAY_SECRET_KEY is not configured');
    err.code = 'monipay_not_configured';
    throw err;
  }

  const res = await fetch(`${BASE_URL()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  return { ok: res.ok, status: res.status, body: parsed };
}

/**
 * Send money to an agent's bank account.
 *
 * @param {Object} opts
 * @param {string} opts.reference    - Our idempotency key: the agent_payouts.id
 * @param {number} opts.amountKobo   - Integer kobo
 * @param {Object} opts recipient    - { account_number, bank_code, account_name }
 * @param {string} opts.narration    - Bank statement description
 * @returns {{ ok: boolean, reference?: string, raw: Object, failureReason?: string }}
 */
export async function createTransfer({ reference, amountKobo, recipient, narration }) {
  if (!payoutsEnabled()) {
    return { ok: false, failureReason: 'payouts_disabled', raw: { disabled: true } };
  }
  if (payoutProvider() !== 'monipay') {
    return { ok: false, failureReason: `unsupported_provider:${payoutProvider()}`, raw: {} };
  }

  // PLACEHOLDER SHAPE — see banner. Do not trust this against production.
  const result = await monipayRequest('/transfer/create', {
    body: {
      reference,
      amount: Math.trunc(amountKobo),
      currency: 'NGN',
      recipient_account: recipient.account_number,
      recipient_bank: recipient.bank_code,
      recipient_name: recipient.account_name,
      narration,
    },
  });

  if (!result.ok) {
    logError('[AgentPayout] Transfer create rejected', { reference, status: result.status, body: result.body });
    return { ok: false, failureReason: `http_${result.status}`, raw: result.body };
  }

  const data = result.body?.data || result.body;
  const providerReference = data?.reference || data?.transfer_reference || data?.id || reference;
  logInfo('[AgentPayout] Transfer created', { reference, providerReference });
  return { ok: true, reference: providerReference, raw: result.body };
}

/**
 * Confirm a transfer settled. Called from the webhook and from the admin retry
 * path when a transfer is left in processing.
 */
export async function verifyTransfer(providerReference) {
  if (!payoutsEnabled()) {
    return { ok: false, status: 'disabled', raw: { disabled: true } };
  }

  // PLACEHOLDER SHAPE — see banner.
  const result = await monipayRequest(`/transfer/verify/${encodeURIComponent(providerReference)}`, {
    method: 'GET',
  });

  if (!result.ok) {
    return { ok: false, status: 'unknown', raw: result.body };
  }

  const data = result.body?.data || result.body;
  const status = String(data?.status || '').toLowerCase();
  const settled = status === 'success' || status === 'successful' || status === 'completed' || data?.success === true;
  return { ok: settled, status: status || 'unknown', raw: result.body };
}

/**
 * Best-effort parse of an inbound provider webhook into a payout transition.
 * Returns null for events we do not recognise so the route can ignore them
 * rather than 500 — an unrecognised event must never break the webhook.
 */
export function parseTransferEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const event = String(body.event || body.type || '').toLowerCase();
  const data = body.data || body;
  const providerReference = data?.reference || data?.transfer_reference || data?.id;

  if (!providerReference) return null;

  if (event.includes('transfer') && (event.includes('success') || event.includes('complete'))) {
    return { providerReference, outcome: 'success', raw: body };
  }
  if (event.includes('transfer') && (event.includes('fail') || event.includes('revers') || event.includes('decline'))) {
    return { providerReference, outcome: 'failed', raw: body, reason: data?.reason || data?.failure_reason || event };
  }
  logWarn('[AgentPayout] Ignoring unrecognised provider event', { event });
  return null;
}
