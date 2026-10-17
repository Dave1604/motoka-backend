/**
 * FACEBOOK / INSTAGRAM MESSENGER CONTROLLER
 *
 * Receives inbound DMs from Meta's webhook, answers them with GPT-4o
 * (same model Mo uses in-app), and escalates to a human when the bot
 * cannot help.
 *
 * Escalation is two-layered:
 *   1. Hard keywords in the customer's message (refund, fraud, "speak to
 *      a human", legal threats) always escalate, regardless of what the
 *      model decided — these are too high-stakes to let a model absorb.
 *   2. The model itself may end its reply with [ESCALATE:reason], which
 *      fires when it genuinely cannot answer or the question needs an
 *      account it cannot see.
 *
 * Once escalated the conversation flips to human mode: the bot goes
 * silent, the owner replies directly in Meta's own inbox, and after
 * HUMAN_MODE_TTL_MS of inactivity the thread auto-resolves so the bot
 * picks back up if the human never got to it.
 *
 * The webhook acks 200 immediately and processes in the background —
 * Meta retries slow endpoints aggressively and a retry would mean a
 * duplicate reply to the customer.
 */

import {
  verifyWebhook,
  verifySignature,
  sendTextMessage,
} from '../services/facebook/messenger.service.js';
import { sendEscalationAlert } from '../services/facebook/escalation.service.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';

// Keep enough turns for the model to follow a thread, not enough to blow
// the token budget on a chatty stranger.
const MAX_HISTORY_ENTRIES = 12;

// After this long in human mode with no new inbound, flip back to bot.
// Twenty-four hours matches Meta's own customer-service window — once it
// lapses the business can no longer send freeform replies anyway.
const HUMAN_MODE_TTL_MS = 24 * 60 * 60 * 1000;

// Meta retries a webhook when the response is slow or non-200, which would
// mean the customer gets the same reply twice. Small recent-mid cache
// catches those duplicates in-process.
const RECENT_MIDS = new Set();
const RECENT_MIDS_MAX = 2000;

// ─── System prompt ───────────────────────────────────────────────────────────
//
// Deliberately leaner than the in-app Mo prompt: a Facebook stranger gets
// no ACTION tags (nowhere to navigate to) and no personal data. The
// escalation block is the important part — it teaches the model when to
// hand off rather than improvise.

function buildSystemPrompt() {
  return `You are Mo, Motoka's assistant on Facebook and Instagram. You're talking to someone who messaged Motoka's page, most likely from an advertisement.

About Motoka:
- Nigerian platform for renewing vehicle papers online: vehicle licence, road worthiness, third-party insurance, driver's licence, plate numbers, proof of ownership.
- Renewals are handled through a licensed, MVAA-certified agent network. Most complete within 24-48 hours.
- Motoka stores digital copies of documents and sends reminders before anything expires.
- Ladipo marketplace sells verified car parts with fitment filters.
- People can start a renewal without an account and sign up at checkout.

Rules:
- Answer only questions about Motoka, Nigerian vehicle paperwork, and general car ownership in Nigeria. For anything else, say that is outside what you can help with here.
- Never quote a specific price. Prices vary by state and vehicle; the exact fee is shown in the app before anyone pays.
- You cannot look up a plate number, check anyone's documents, or see any account. If asked, explain they need to use the Motoka app.
- Never ask for or accept BVN, NIN, card details, passwords, or any document number.
- Keep answers to three sentences or fewer. Plain, friendly, Nigerian English.
- If they want to actually renew something, point them to motokaapp.ng or the Motoka app.
- Respond in the same language they write in, including Pidgin.

ESCALATION — you are the first line of support, not the last. You MUST escalate when:
- The question is about money already paid: refunds, failed payments, "I paid but...", order status for a specific person.
- The customer is angry, accusing Motoka of fraud, or threatening legal action.
- They explicitly ask for a human, agent, or real person.
- The question requires access to an account, specific order, or document you cannot see.
- You genuinely do not understand the question.
- They ask about partnerships, bulk or corporate accounts, press, or investment.

To escalate, write a brief holding line like "Let me check that with our team" and end your reply with [ESCALATE:short reason] on its own line. Do not tell the customer you are escalating to a human — the system handles that.

Do NOT escalate for: general questions about services, how Motoka works, whether documents are genuine, general car maintenance, traffic rules, or anything you can answer from the rules above.`;
}

// ─── Hard-escalation keywords ────────────────────────────────────────────────
//
// Checked against the customer's raw message before the model even runs.
// If any of these fire, we skip the model's answer entirely and send the
// holding message — a refund threat should never get a cheerful bot reply.

const HARD_ESCALATE_RE =
  /\b(refund|chargeback|fraud|scam(?:med|mer)?|sue|lawsuit|lawyer|attorney|legal action|court|report you|consumer protection|speak to (?:a |an |the )?(?:human|person|agent|real person|manager|supervisor)|talk to (?:a |an |the )?(?:human|person|agent|real person|manager|supervisor)|real person|human being|fed up|disappointed|terrible service|worst)\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESCALATE_TAG_RE = /\[ESCALATE:(.+?)\]\s*$/i;

function cleanResponse(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function parseEscalate(text) {
  const match = text.match(ESCALATE_TAG_RE);
  if (!match) return { reply: text, escalate: null };
  return {
    reply: text.replace(ESCALATE_TAG_RE, '').trim(),
    escalate: match[1].trim() || 'Model flagged uncertainty',
  };
}

async function fetchRecipientName(psid) {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${psid}?fields=first_name,last_name&access_token=${token}`
    );
    const data = await res.json();
    if (data.first_name) {
      return `${data.first_name} ${data.last_name || ''}`.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_HISTORY_ENTRIES);
}

// ─── Conversation persistence ────────────────────────────────────────────────

async function getConversation(psid, channel) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('facebook_conversations')
    .select('*')
    .eq('psid', psid)
    .eq('channel', channel)
    .maybeSingle();

  if (error) {
    logError('[Facebook] Conversation read failed', { psid, channel, error: error.message });
    return null;
  }

  if (data) return data;

  // First time we've seen this thread — create it. A concurrent duplicate
  // insert loses the race on the UNIQUE(psid, channel) constraint; re-read.
  const { data: created, error: insertError } = await supabase
    .from('facebook_conversations')
    .insert({ psid, channel, status: 'bot', history: [] })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('facebook_conversations')
        .select('*')
        .eq('psid', psid)
        .eq('channel', channel)
        .maybeSingle();
      return existing;
    }
    logError('[Facebook] Conversation create failed', { psid, channel, error: insertError.message });
    return null;
  }

  return created;
}

async function saveConversation(psid, channel, patch) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('facebook_conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('psid', psid)
    .eq('channel', channel);

  if (error) {
    logError('[Facebook] Conversation write failed', { psid, channel, error: error.message });
  }
  return !error;
}

// ─── GPT call ────────────────────────────────────────────────────────────────

async function askModel(history) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 300,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI error ${res.status}`);
  }

  return data.choices?.[0]?.message?.content?.trim() || "I'm not sure how to help with that.";
}

// ─── Webhook handlers ────────────────────────────────────────────────────────

/**
 * GET /api/v1/facebook/webhook
 *
 * Meta's verification handshake. Runs once when the webhook is configured
 * in the App Dashboard, and again on any "Verify" click.
 */
export function verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const echoed = verifyWebhook({ mode, verifyToken: token, challenge });
  if (!echoed) {
    return res.sendStatus(403);
  }
  logInfo('[Facebook] Webhook verified');
  return res.status(200).send(echoed);
}

/**
 * POST /api/v1/facebook/webhook
 *
 * Inbound messages. Mounted behind express.raw() so the signature check
 * sees the exact bytes Meta signed — express.json() would have already
 * mutated req.body into a parsed object.
 */
export async function webhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!raw) {
    return res.sendStatus(400);
  }

  if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
    logWarn('[Facebook] Rejected webhook: bad signature');
    return res.sendStatus(401);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return res.sendStatus(400);
  }

  // Meta sends a single "hub.challenge" GET for verification; POSTs carry
  // object=page (Messenger) or object=instagram (Instagram Messaging).
  if (payload.object !== 'page' && payload.object !== 'instagram') {
    return res.sendStatus(404);
  }

  const channel = payload.object === 'instagram' ? 'instagram' : 'messenger';

  // Ack fast — Meta's retry window is twenty seconds and a retry means a
  // duplicate reply. Errors are logged, not surfaced to the sender.
  res.sendStatus(200);

  const events = (payload.entry || []).flatMap((entry) => entry.messaging || []);

  for (const event of events) {
    // Process sequentially per webhook call to keep history ordering sane
    // when a customer sends several messages in quick succession.
    await processEvent(event, channel).catch((err) => {
      logError('[Facebook] Event processing failed', {
        channel,
        sender: event?.sender?.id,
        error: err.message,
      });
    });
  }
}

async function processEvent(event, channel) {
  const psid = event?.sender?.id;
  const message = event?.message;

  // Only inbound text. Everything else — echoes of our own sends, delivery
  // and read receipts, postbacks — is acknowledged by the 200 above and
  // intentionally ignored here.
  if (!psid || !message || message.is_echo || !message.text) return;

  // Dedupe Meta retries within this process.
  const mid = message.mid;
  if (mid) {
    if (RECENT_MIDS.has(mid)) return;
    RECENT_MIDS.add(mid);
    if (RECENT_MIDS.size > RECENT_MIDS_MAX) {
      const oldest = RECENT_MIDS.values().next().value;
      RECENT_MIDS.delete(oldest);
    }
  }

  const text = message.text.trim();
  if (!text) return;

  logInfo('[Facebook] Inbound message', { channel, psid, length: text.length });

  const conv = await getConversation(psid, channel);
  if (!conv) {
    // No state, no reply — better silent than half-tracked.
    logError('[Facebook] No conversation row; dropping message', { psid, channel });
    return;
  }

  const now = Date.now();
  let status = conv.status;
  const history = trimHistory([...(conv.history || []), { role: 'user', content: text, at: new Date().toISOString() }]);

  // Human-mode TTL: if the thread has been silent long enough, the human
  // clearly didn't take it — flip back to bot and answer normally.
  if (status === 'human' && conv.escalated_at) {
    const escalatedAt = new Date(conv.escalated_at).getTime();
    if (now - escalatedAt > HUMAN_MODE_TTL_MS) {
      logInfo('[Facebook] Human-mode TTL lapsed; re-activating bot', { psid, channel });
      status = 'bot';
    }
  }

  if (status === 'human') {
    // A human owns this thread. Log the turn for context but send nothing
    // — the owner is replying from Meta's own inbox and a bot interjection
    // would collide with them.
    await saveConversation(psid, channel, {
      history,
      last_message_at: new Date().toISOString(),
    });
    logInfo('[Facebook] Human mode — bot staying silent', { psid, channel });
    return;
  }

  // Hard keywords fire before the model runs.
  if (HARD_ESCALATE_RE.test(text)) {
    await escalate({ psid, channel, history, customerMessage: text, reason: 'Sensitive topic in customer message' });
    return;
  }

  // Ask the model.
  let raw;
  try {
    raw = await askModel(history);
  } catch (err) {
    logError('[Facebook] Model call failed', { psid, channel, error: err.message });
    // Fail open to a human rather than a broken bot: escalate so the
    // customer is not left on read because OpenAI had a bad minute.
    await escalate({ psid, channel, history, customerMessage: text, reason: `Model error: ${err.message}` });
    return;
  }

  const cleaned = cleanResponse(raw);
  const { reply, escalate: modelReason } = parseEscalate(cleaned);

  if (modelReason) {
    await escalate({ psid, channel, history, customerMessage: text, reason: modelReason });
    return;
  }

  // Normal answer.
  await sendTextMessage(psid, reply);

  await saveConversation(psid, channel, {
    status: 'bot',
    history: trimHistory([...history, { role: 'assistant', content: reply, at: new Date().toISOString() }]),
    last_message_at: new Date().toISOString(),
  });
}

async function escalate({ psid, channel, history, customerMessage, reason }) {
  // Holding message to the customer — short, no promise of a timeframe
  // we cannot keep.
  await sendTextMessage(
    psid,
    'Thanks for reaching out! Let me connect you with our team — someone will be with you shortly.'
  );

  await saveConversation(psid, channel, {
    status: 'human',
    escalated_at: new Date().toISOString(),
    escalation_reason: reason,
    history: trimHistory([...history, { role: 'assistant', content: '[escalated to human]', at: new Date().toISOString() }]),
    last_message_at: new Date().toISOString(),
  });

  const customerName = await fetchRecipientName(psid);

  // Fire-and-forget: the customer already has their holding message, so a
  // failed alert must not block anything.
  sendEscalationAlert({
    channel,
    psid,
    customerName,
    customerMessage,
    reason,
    recentHistory: history,
  }).catch((err) => {
    logError('[Facebook] Escalation alert threw', { psid, error: err.message });
  });

  logInfo('[Facebook] Escalated to human', { channel, psid, reason });
}
