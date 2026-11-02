-- MIGRATION 118 – State-based agent assignment, profit tracking, work progress
--
-- Builds on 111_agent_pipeline.sql. Agents now cover states, costs can differ
-- by state, each payout records what Motoka kept, and every order has a
-- progress history so we can see who is working on a customer's document.
--
-- Nothing here moves money. An agent with no agent_states row is simply never
-- auto-assigned, so orders stay unassigned until an admin sets coverage.

-- ── Which states each agent covers ─────────────────────────────────────────
-- `state` holds the renewal_state name ("Lagos", "Ogun"), not a 2-letter code.
CREATE TABLE IF NOT EXISTS public.agent_states (
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, state)
);

CREATE INDEX IF NOT EXISTS idx_agent_states_state ON public.agent_states (state);

-- ── Agent identity documents ───────────────────────────────────────────────
-- NIN images are government IDs, so this bucket is private, unlike car-documents.
-- The backend reads them with the service role and hands out short-lived signed
-- URLs, so there are deliberately no storage policies.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS nin_front_path TEXT,
  ADD COLUMN IF NOT EXISTS nin_back_path TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agent-documents',
  'agent-documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ── Costs per state ────────────────────────────────────────────────────────
-- 'default' applies to any state without its own row. It is a value rather than
-- NULL so the upsert can target a plain unique index. Existing rows become the
-- default, so current costs keep working.
ALTER TABLE public.agent_service_costs
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'default';

ALTER TABLE public.agent_service_costs
  DROP CONSTRAINT IF EXISTS agent_service_costs_service_type_service_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_service_costs_type_key_state
  ON public.agent_service_costs (service_type, service_key, state);

-- ── Profit on the ledger ───────────────────────────────────────────────────
-- customer_amount_kobo is what the customer actually paid for the service,
-- excluding delivery. profit_kobo is that minus amount_kobo. It is NULL while
-- the cost is incomplete, because a partial cost would overstate the profit.
ALTER TABLE public.agent_payouts
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS customer_amount_kobo BIGINT,
  ADD COLUMN IF NOT EXISTS profit_kobo BIGINT,
  ADD COLUMN IF NOT EXISTS breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;

-- `cancelled` is a row replaced by a retry or a reassignment. It stays visible
-- but can no longer be paid and is left out of the totals.
ALTER TABLE public.agent_payouts DROP CONSTRAINT IF EXISTS agent_payouts_status_check;
ALTER TABLE public.agent_payouts ADD CONSTRAINT agent_payouts_status_check
  CHECK (status IN ('pending','processing','success','failed','manual_review','cancelled'));

CREATE INDEX IF NOT EXISTS idx_agent_payouts_state ON public.agent_payouts (state);

-- ── Work progress ──────────────────────────────────────────────────────────
ALTER TABLE public.renewal_orders
  ADD COLUMN IF NOT EXISTS agent_work_status TEXT
  CHECK (agent_work_status IN ('assigned','in_progress','submitted','completed','rejected'));
ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS agent_work_status TEXT
  CHECK (agent_work_status IN ('assigned','in_progress','submitted','completed','rejected'));

CREATE TABLE IF NOT EXISTS public.agent_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type TEXT NOT NULL CHECK (order_type IN ('regular','guest')),
  regular_order_id BIGINT,
  guest_order_id UUID,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('assigned','in_progress','submitted','completed','rejected','reassigned')),
  note TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_order_events_one_order_ref CHECK (
    (order_type = 'regular' AND regular_order_id IS NOT NULL AND guest_order_id IS NULL)
    OR (order_type = 'guest' AND guest_order_id IS NOT NULL AND regular_order_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_order_events_regular
  ON public.agent_order_events (regular_order_id, created_at) WHERE regular_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_order_events_guest
  ON public.agent_order_events (guest_order_id, created_at) WHERE guest_order_id IS NOT NULL;

-- ── Backfill rows written before this migration ────────────────────────────
UPDATE public.renewal_orders SET agent_work_status = 'assigned'
  WHERE assigned_agent_id IS NOT NULL AND agent_work_status IS NULL;
UPDATE public.guest_renewal_orders SET agent_work_status = 'assigned'
  WHERE assigned_agent_id IS NOT NULL AND agent_work_status IS NULL;

UPDATE public.agent_payouts p
  SET state = COALESCE(o.renewal_state, o.metadata->>'renewal_state'),
      customer_amount_kobo = o.renewal_amount::BIGINT,
      profit_kobo = CASE WHEN p.missing_costs = '[]'::jsonb THEN o.renewal_amount::BIGINT - p.amount_kobo END
  FROM public.renewal_orders o
  WHERE p.order_type = 'regular' AND p.regular_order_id = o.id AND p.customer_amount_kobo IS NULL;

UPDATE public.agent_payouts p
  SET state = o.renewal_state,
      customer_amount_kobo = o.renewal_amount,
      profit_kobo = CASE WHEN p.missing_costs = '[]'::jsonb THEN o.renewal_amount - p.amount_kobo END
  FROM public.guest_renewal_orders o
  WHERE p.order_type = 'guest' AND p.guest_order_id = o.id AND p.customer_amount_kobo IS NULL;

ALTER TABLE public.agent_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_order_events ENABLE ROW LEVEL SECURITY;

-- Service-role only, same posture as 111.
