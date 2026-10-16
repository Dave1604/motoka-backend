import { getSupabaseAdmin } from '../../config/supabase.js';
import { logWarn } from '../../utils/logger.js';

const IDEMPOTENCY_KEY_TTL_HOURS = 24;

/**
 * Check for existing idempotency response. Returns cached response if found and valid.
 * @param {string} key - Idempotency-Key header value
 * @param {string} userId - Current user ID (must match)
 * @returns {{ cached: boolean, response?: object, status?: string } | null}
 */
export async function getIdempotencyResponse(key, userId) {
  if (!key || typeof key !== 'string' || key.length > 255) return null;

  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('payment_idempotency')
    .select('status, response_json, user_id, created_at')
    .eq('idempotency_key', key)
    .gte('created_at', cutoff)
    .single();

  if (error || !data) return null;
  if (data.user_id !== userId) {
    logWarn('[Idempotency] Key belongs to different user', { key: key.slice(0, 8) });
    return null;
  }
  if (data.status === 'processing') {
    return { cached: false, status: 'processing' };
  }
  if (data.status === 'completed' && data.response_json) {
    return { cached: true, response: data.response_json };
  }
  if (data.status === 'failed') {
    return { cached: true, response: data.response_json, status: 'failed' };
  }
  return null;
}

/**
 * Reserve idempotency key (call at start of processing).
 * Returns 'reserved' when we got the lock, 'duplicate' when the key already
 * exists, and 'error' on any other database failure. Callers must NOT present
 * 'error' as a duplicate — a transient DB error used to surface as
 * "Duplicate request" (409), which misdirected both the user and whoever
 * debugged it.
 * @param {string} key
 * @param {string} userId
 * @returns {Promise<'reserved'|'duplicate'|'error'>}
 */
export async function reserveIdempotencyKey(key, userId) {
  if (!key || typeof key !== 'string' || key.length > 255) return 'duplicate';

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('payment_idempotency').insert({
    idempotency_key: key,
    user_id: userId,
    status: 'processing',
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === '23505') return 'duplicate'; // Unique violation = already exists
    logWarn('[Idempotency] Reserve failed', { error: error.message });
    return 'error';
  }
  return 'reserved';
}

/**
 * Store completed idempotency response.
 */
export async function storeIdempotencyResponse(key, userId, transactionId, response, isError = false) {
  if (!key) return;

  const supabase = getSupabaseAdmin();
  await supabase
    .from('payment_idempotency')
    .update({
      transaction_id: transactionId,
      status: isError ? 'failed' : 'completed',
      response_json: response,
      updated_at: new Date().toISOString(),
    })
    .eq('idempotency_key', key)
    .eq('user_id', userId);
}
