import { logError, logInfo, logWarn } from '../../utils/logger.js';

/**
 * MONEY OUT — agent payments through Monipay.
 *
 * Endpoints from https://monipay.ng/api-docs: POST /transferrecipient,
 * POST /transfer, GET /transfer and GET /transfer/{id_or_code}. Not yet proven
 * against the live API, and the docs do not show the transfer webhook's body, so
 * parseTransferEvent reads the likely fields defensively.
 *
 * The result of creating a transfer is three-way on purpose. "Rejected" means no
 * money moved, so a retry is safe. "Unknown" (a timeout or a server error) means
 * money may have moved, and treating that as a failure could pay an agent twice.
 */

const BASE_URL = () => (process.env.MONIPAY_BASE_URL || 'https://api.monipay.ng').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 30_000;
const TRANSFER_LIST_SIZE = 100;
// Only replies that clearly mean "we did nothing". Anything else, including a 409
// duplicate (a transfer with this reference may exist), could mean money moved.
const REFUSED_STATUSES = new Set([400, 401, 403, 404, 422, 429]);

export function payoutsEnabled() {
  return String(process.env.AGENT_PAYOUTS_ENABLED || '').toLowerCase() === 'true';
}

/** Per-transfer ceiling. Anything above goes to manual review. */
export function autoPayoutLimitKobo() {
  const raw = Number(process.env.AGENT_AUTO_PAYOUT_LIMIT_KOBO || 50000000); // ₦500,000
  return Number.isFinite(raw) && raw > 0 ? raw : 50000000;
}

/** Most that can be released in one day, across all admins. */
export function dailyPayoutLimitKobo() {
  const raw = Number(process.env.AGENT_DAILY_PAYOUT_LIMIT_KOBO || 500000000); // ₦5,000,000
  return Number.isFinite(raw) && raw > 0 ? raw : 500000000;
}

/** A new or changed bank account waits this long before money can go to it. */
export function bankChangeCooldownMs() {
  const hours = Number(process.env.AGENT_BANK_CHANGE_COOLDOWN_HOURS ?? 24);
  return Number.isFinite(hours) && hours >= 0 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

/** How recently an admin must have logged in to send money. */
export function releaseLoginMaxAgeMs() {
  const minutes = Number(process.env.AGENT_RELEASE_LOGIN_MAX_AGE_MINUTES ?? 30);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

/** Only these admins can send money. Empty means nobody can: the safe default. */
export function canReleasePayments(email) {
  const allowed = String(process.env.AGENT_PAYOUT_RELEASER_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email) && allowed.includes(String(email).toLowerCase());
}

async function monipayRequest(path, { method = 'POST', body } = {}) {
  const key = process.env.MONIPAY_SECRET_KEY;
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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  return { ok: res.ok && parsed?.status !== false, status: res.status, body: parsed };
}

/**
 * Register a bank account with Monipay. It verifies the account first, so the
 * returned name is what the bank has on record.
 */
export async function createTransferRecipient({ name, accountNumber, bankCode }) {
  try {
    const result = await monipayRequest('/transferrecipient', {
      body: { type: 'nuban', name, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' },
    });
    const data = result.body?.data;
    if (!result.ok || !data?.recipient_code) {
      logError('[AgentPayout] Recipient rejected', { status: result.status, message: result.body?.message });
      return { ok: false, reason: result.body?.message || `Monipay could not verify this account (${result.status})` };
    }
    return { ok: true, recipientCode: data.recipient_code, accountName: data.details?.account_name || null };
  } catch (err) {
    logError('[AgentPayout] Recipient request failed', { error: err.message });
    return { ok: false, reason: 'Could not reach Monipay. No money moved, so you can try again.' };
  }
}

/**
 * Send money from the Monipay balance. The narration carries the payout id, which
 * is how a transfer whose response was lost can be found later: GET /transfer
 * cannot be searched by reference.
 *
 * @returns {{ outcome: 'accepted'|'rejected'|'unknown', transferCode?: string, status?: string, reason?: string, raw: Object }}
 */
export async function createTransfer({ reference, amountKobo, recipientCode }) {
  try {
    const result = await monipayRequest('/transfer', {
      body: {
        source: 'balance',
        amount: Math.trunc(amountKobo),
        recipient: recipientCode,
        reason: `Motoka payout ${reference}`,
        currency: 'NGN',
        reference,
      },
    });

    if (result.ok) {
      const data = result.body?.data || {};
      logInfo('[AgentPayout] Transfer accepted', { reference, transferCode: data.transfer_code, status: data.status });
      if (!data.transfer_code) {
        return { outcome: 'unknown', reason: 'Monipay accepted the transfer without a transfer code', raw: result.body };
      }
      return { outcome: 'accepted', transferCode: data.transfer_code, status: normaliseState(data.status), amountKobo: providerAmount(data), raw: result.body };
    }

    const reason = result.body?.message || `Monipay returned ${result.status}`;
    logError('[AgentPayout] Transfer not accepted', { reference, status: result.status, message: reason });
    return { outcome: REFUSED_STATUSES.has(result.status) ? 'rejected' : 'unknown', reason, raw: result.body };
  } catch (err) {
    if (err.code === 'monipay_not_configured') {
      return { outcome: 'rejected', reason: err.message, raw: {} };
    }
    logError('[AgentPayout] Transfer request failed', { reference, error: err.message });
    return { outcome: 'unknown', reason: err.message, raw: { error: err.message } };
  }
}

function providerAmount(data) {
  const amount = Number(data?.amount);
  return data?.amount !== undefined && data?.amount !== null && Number.isFinite(amount) ? amount : null;
}

function normaliseState(status) {
  const value = String(status || '').toLowerCase();
  if (['success', 'successful', 'completed'].includes(value)) return 'success';
  if (['failed', 'reversed', 'declined', 'rejected'].includes(value)) return 'failed';
  return 'pending';
}

/** Ask Monipay where a transfer stands. `unknown` means it could not say. */
export async function verifyTransfer(transferCode) {
  try {
    const result = await monipayRequest(`/transfer/${encodeURIComponent(transferCode)}`, { method: 'GET' });
    if (!result.ok) return { state: 'unknown', raw: result.body };
    return { state: normaliseState(result.body?.data?.status), amountKobo: providerAmount(result.body?.data), raw: result.body };
  } catch (err) {
    logError('[AgentPayout] Transfer lookup failed', { transferCode, error: err.message });
    return { state: 'unknown', raw: { error: err.message } };
  }
}

/** Find a transfer by the payout id in its narration, for when its response was lost. */
export async function findTransferForPayout(payoutId) {
  try {
    const result = await monipayRequest(`/transfer?perPage=${TRANSFER_LIST_SIZE}`, { method: 'GET' });
    if (!result.ok || !Array.isArray(result.body?.data)) return null;
    const match = result.body.data.find((t) => String(t.reason || '').includes(payoutId));
    return match?.transfer_code ? { transferCode: match.transfer_code } : null;
  } catch (err) {
    logError('[AgentPayout] Transfer list failed', { payoutId, error: err.message });
    return null;
  }
}

/**
 * Parse a transfer.* webhook into a payout change. Returns null for events we do
 * not recognise, so the route ignores them rather than failing the webhook.
 * `references` holds every id the event carries, because the body is undocumented.
 */
export function parseTransferEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const event = String(body.event || body.type || '').toLowerCase();
  const data = body.data || body;
  const references = [data?.transfer_code, data?.reference, data?.id]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(String);

  if (references.length === 0 || !event.includes('transfer')) return null;

  if (event.includes('success') || event.includes('complete')) {
    return { references, outcome: 'success', amountKobo: providerAmount(data), raw: body };
  }
  if (event.includes('revers')) {
    return { references, outcome: 'reversed', raw: body, reason: 'Monipay reversed this transfer' };
  }
  if (event.includes('fail') || event.includes('decline')) {
    return { references, outcome: 'failed', raw: body, reason: data?.reason || data?.failure_reason || 'Monipay reported this transfer failed' };
  }
  logWarn('[AgentPayout] Ignoring unrecognised provider event', { event });
  return null;
}
