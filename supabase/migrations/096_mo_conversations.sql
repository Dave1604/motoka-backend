-- Mo conversation log: every question asked of the Mo assistant (signed-in
-- `chat` and public marketing-site `publicChat`), stored for marketing
-- intelligence (search-gap mining: what visitors ask → content/supply gaps).
--
-- Written fire-and-forget by the backend after the reply is sent, so logging
-- can never slow down or break a chat response. No RLS policies: only the
-- service_role (backend) reads/writes; admins read via the API.

CREATE TABLE IF NOT EXISTS public.mo_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('chat', 'public')),
  question TEXT NOT NULL,
  answer TEXT NULL,
  action_type TEXT NULL,
  has_ladipo_search BOOLEAN NOT NULL DEFAULT FALSE,
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  ip_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mo_conversations_created_at_idx
  ON public.mo_conversations (created_at DESC);
CREATE INDEX IF NOT EXISTS mo_conversations_source_idx
  ON public.mo_conversations (source);
CREATE INDEX IF NOT EXISTS mo_conversations_user_id_idx
  ON public.mo_conversations (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.mo_conversations ENABLE ROW LEVEL SECURITY;
