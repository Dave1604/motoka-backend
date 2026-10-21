-- Facebook / Instagram conversation state for the Mo follow-up bot.
-- Migration 106.
--
-- One row per (psid, channel). psid is the Facebook Page-Scoped ID — the
-- same human has a different psid on Messenger and Instagram, hence the
-- composite unique key rather than psid alone.
--
-- status:
--   bot      — Mo answers normally
--   human    — escalated; Mo stays silent until resolved or the TTL lapses
--   resolved — human closed the thread; Mo may answer again
--
-- history is a rolling window of {role, content, at} objects, trimmed in
-- the controller. It exists so the webhook can stay stateless between
-- requests while Mo still sees enough context to hold a conversation.

CREATE TABLE IF NOT EXISTS public.facebook_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  psid TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'messenger',
  status TEXT NOT NULL DEFAULT 'bot',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalated_at TIMESTAMPTZ,
  escalation_reason TEXT,
  resolved_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (psid, channel)
);

-- Only active escalations are looked up by the owner dashboard.
CREATE INDEX IF NOT EXISTS idx_facebook_conversations_escalated
  ON public.facebook_conversations (escalated_at DESC)
  WHERE status = 'human';

-- TTL sweeper: conversations whose human-mode window has lapsed.
CREATE INDEX IF NOT EXISTS idx_facebook_conversations_human_stale
  ON public.facebook_conversations (escalated_at)
  WHERE status = 'human';

ALTER TABLE public.facebook_conversations ENABLE ROW LEVEL SECURITY;

-- Service-role only — no anon/authenticated policies on purpose.
-- The bot runs server-side with the service key; nothing in the client
-- should read or write these rows.
