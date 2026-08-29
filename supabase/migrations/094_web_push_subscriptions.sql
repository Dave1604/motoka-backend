-- =============================================
-- Web Push subscriptions + notification preferences
-- =============================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Service role / backend only — no direct client access
DROP POLICY IF EXISTS push_subscriptions_deny_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_deny_all
  ON public.push_subscriptions
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Preference columns on profiles (defaults: push off until user grants OS permission)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_push BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE public.push_subscriptions IS 'Web Push endpoints for Motoka PWA notifications';
COMMENT ON COLUMN public.profiles.notify_push IS 'User opted in to Web Push notifications';
