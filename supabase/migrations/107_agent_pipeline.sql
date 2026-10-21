-- AGENT FULFILMENT PIPELINE
-- Migration 107.
--
-- Replaces the dead delivery-agent module (frontend AdminAgents/CreateAgent/
-- AgentView already existed and called /admin/agents, which never existed on the
-- backend). These are fulfilment agents: people Motoka pays to process vehicle
-- documents at FRSC/VIO, then gets reimbursed against.
--
-- Three tables:
--   agents              — who can be paid, and where the money goes
--   agent_service_costs — what each service costs the agent (kobo). Sourced from
--                         FRSC/VIO face value; the platform margin is the gap
--                         between this and the customer price in renewal_items /
--                         plate_number_prices / driver_license_prices.
--   agent_payouts       — the ledger. One row per order assignment. This is the
--                         artefact that kills the "did I pay for this?" problem.
--
-- agent_payouts is append-mostly. `status` moves forward; the only backward
-- transition allowed is processing -> failed (a transfer that never settled).
-- See agentPayout.service.js for the enforced transitions.

CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  bank_name TEXT,
  bank_code TEXT,
  account_number TEXT,
  account_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- service_type: renewal_item | plate_number | driver_license
-- service_key:  renewal_item  -> renewal_items.item_key
--               plate_number  -> plate_type (Normal|Customized|Dealership|Reprint)
--               driver_license-> "{license_type}:{duration}" (new:3yr, renew:5yr …)
-- cost_kobo is what the agent hands over at the counter, in kobo to match
-- renewal_items.price. Never store Naira here — the two unit systems coexisting
-- is exactly the kind of thing that loses money at scale.
CREATE TABLE IF NOT EXISTS public.agent_service_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL CHECK (service_type IN ('renewal_item','plate_number','driver_license')),
  service_key TEXT NOT NULL,
  cost_kobo INTEGER NOT NULL CHECK (cost_kobo >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_type, service_key)
);

CREATE TABLE IF NOT EXISTS public.agent_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type TEXT NOT NULL CHECK (order_type IN ('regular','guest')),
  -- regular orders are BIGSERIAL, guest orders are UUID — hence two nullable
  -- columns rather than one polymorphic id. Exactly one is set; CHECK enforces it.
  regular_order_id BIGINT,
  guest_order_id UUID,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE RESTRICT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','success','failed','manual_review')),
  provider TEXT NOT NULL DEFAULT 'monipay',
  provider_reference TEXT,
  provider_response JSONB,
  failure_reason TEXT,
  -- Items on the order that had no cost row at assignment time. Non-empty means
  -- the auto-transfer was withheld and the payout is in manual_review.
  missing_costs JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_payouts_one_order_ref CHECK (
    (order_type = 'regular' AND regular_order_id IS NOT NULL AND guest_order_id IS NULL)
    OR (order_type = 'guest'   AND guest_order_id   IS NOT NULL AND regular_order_id IS NULL)
  )
);

-- At most one live payout per order. `failed` and `manual_review` are excluded
-- so an operator can retry (a new row) without the dead attempt blocking it,
-- while success/pending/processing can never be duplicated — this is the
-- double-pay guard, enforced by the database rather than by application code
-- that might have a race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_payouts_regular_live
  ON public.agent_payouts (regular_order_id)
  WHERE order_type = 'regular' AND status IN ('pending','processing','success');

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_payouts_guest_live
  ON public.agent_payouts (guest_order_id)
  WHERE order_type = 'guest' AND status IN ('pending','processing','success');

CREATE INDEX IF NOT EXISTS idx_agent_payouts_agent   ON public.agent_payouts (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_payouts_status  ON public.agent_payouts (status);
CREATE INDEX IF NOT EXISTS idx_agent_payouts_assigned ON public.agent_payouts (assigned_at DESC);

ALTER TABLE public.renewal_orders
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES public.agents(id);
ALTER TABLE public.guest_renewal_orders
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES public.agents(id);

ALTER TABLE public.agents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_service_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_payouts      ENABLE ROW LEVEL SECURITY;

-- Service-role only. Agents must never be able to read their own payout rows
-- (the ledger is internal accounting, not a statement we owe them), and no
-- client-side code touches these tables. Same posture as 106.
