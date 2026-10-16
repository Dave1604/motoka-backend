import crypto from 'crypto';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logWarn } from '../../utils/logger.js';

// Cap stored text: mining needs the gist, not a full transcript dump, and a
// hostile client could otherwise stuff megabytes per row.
const MAX_STORE_CHARS = 2000;

function truncate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_STORE_CHARS ? trimmed.slice(0, MAX_STORE_CHARS) : trimmed;
}

export function hashIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Fire-and-forget Mo conversation log. NEVER throws: a logging failure must
// not break a chat response, so every failure path warns and returns null.
// Callers should still `.catch(() => {})` and, where possible, log AFTER
// res.json so the client never waits on the insert.
export async function logMoConversation({
  userId = null,
  source,
  question,
  answer = null,
  actionType = null,
  hasLadipoSearch = false,
  model = 'gpt-4o',
  ipHash = null,
} = {}) {
  try {
    if (source !== 'chat' && source !== 'public') {
      logWarn('[MoLog] Skipping log with invalid source', { source });
      return null;
    }
    const storedQuestion = truncate(question);
    if (!storedQuestion) return null;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('mo_conversations')
      .insert({
        user_id: userId || null,
        source,
        question: storedQuestion,
        answer: truncate(answer),
        action_type: typeof actionType === 'string' && actionType ? actionType.slice(0, 100) : null,
        has_ladipo_search: Boolean(hasLadipoSearch),
        model: typeof model === 'string' && model ? model.slice(0, 50) : 'gpt-4o',
        ip_hash: typeof ipHash === 'string' ? ipHash.slice(0, 128) : null,
      })
      .select('id')
      .single();

    if (error) {
      logWarn('[MoLog] Insert failed', { error: error.message });
      return null;
    }
    return data?.id || null;
  } catch (err) {
    logWarn('[MoLog] Unexpected logging failure', { error: err?.message });
    return null;
  }
}
