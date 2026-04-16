-- Ladipo admin: ownership audit, workflow (blocked), optimistic concurrency version.

ALTER TABLE public.ladipo_orders
  ADD COLUMN IF NOT EXISTS handled_by_key TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS admin_ops_version INT NOT NULL DEFAULT 0;

ALTER TABLE public.ladipo_orders
  DROP CONSTRAINT IF EXISTS chk_ladipo_orders_workflow_state;

ALTER TABLE public.ladipo_orders
  ADD CONSTRAINT chk_ladipo_orders_workflow_state
  CHECK (workflow_state IN ('active', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_ladipo_orders_handled_by_key_assigned
  ON public.ladipo_orders(handled_by_key, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_ladipo_orders_workflow_state
  ON public.ladipo_orders(workflow_state);

-- Backfill canonical key from display name where missing
UPDATE public.ladipo_orders
SET handled_by_key = lower(regexp_replace(trim(both from handled_by_name), '[[:space:]]+', ' ', 'g'))
WHERE handled_by_name IS NOT NULL
  AND trim(both from handled_by_name) <> ''
  AND (handled_by_key IS NULL OR handled_by_key = '');
