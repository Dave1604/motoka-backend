-- MIGRATION 121 – Admin-released agent payments
--
-- Money only leaves when a named admin clicks Release Payment, so `pending` now
-- means "ready to release": nothing is in flight until the row moves to
-- `processing`. Payouts held only because transfers were switched off become
-- ready, since being off is now checked at the moment of release.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS monipay_recipient_code TEXT,
  ADD COLUMN IF NOT EXISTS bank_changed_at TIMESTAMPTZ;

-- Changing where an agent's money goes is the easiest way to steal it, so every
-- change is recorded, with the account number masked.
CREATE TABLE IF NOT EXISTS public.agent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_agent ON public.agent_audit_log (agent_id, created_at DESC);
ALTER TABLE public.agent_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_payouts
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_by TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_payouts_released_at
  ON public.agent_payouts (released_at) WHERE released_at IS NOT NULL;

UPDATE public.agent_payouts p
  SET status = 'pending', failure_reason = NULL, updated_at = now()
  WHERE p.status = 'manual_review'
    AND p.failure_reason = 'payouts_disabled'
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_payouts live
      WHERE live.id <> p.id
        AND live.order_type = p.order_type
        AND live.status IN ('pending','processing','success')
        AND (live.regular_order_id = p.regular_order_id OR live.guest_order_id = p.guest_order_id)
    );
