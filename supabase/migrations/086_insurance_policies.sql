-- Insurance policies issued through an embedded provider (currently Curacel).
--
-- Insurance was previously sourced manually through an agent and never
-- recorded, so a policy could lapse with nothing in the system knowing. This
-- makes it a first-class record: queryable expiry that can feed the existing
-- reminder pipeline, and an explicit NIID status.
--
-- NIID matters more than it looks. It is the database FRSC, the police and VIS
-- actually check at a stop — a certificate that never reached it is worthless
-- to the customer regardless of what the PDF says. Tracking it separately from
-- `status` means "we issued a policy" and "the policy is verifiable at a
-- checkpoint" can never be silently conflated.

create table if not exists public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id uuid not null references public.cars(id) on delete cascade,

  provider text not null default 'curacel',
  provider_quotation_id text,
  provider_reference text,

  policy_number text,
  insurer text,
  cover_type text not null check (cover_type in ('third_party', 'comprehensive')),

  -- Kobo, consistent with payments and wallet elsewhere in this schema.
  premium_kobo bigint,

  status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'cancelled', 'failed')),
  niid_status text not null default 'pending'
    check (niid_status in ('pending', 'registered', 'failed')),
  failure_reason text,

  starts_at timestamptz,
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists insurance_policies_car_idx
  on public.insurance_policies (car_id, created_at desc);

create index if not exists insurance_policies_user_idx
  on public.insurance_policies (user_id);

-- Drives renewal reminders and the reconciliation sweep for policies stuck
-- pending because a webhook never arrived.
create index if not exists insurance_policies_expiry_idx
  on public.insurance_policies (expires_at)
  where status = 'active';

create index if not exists insurance_policies_pending_idx
  on public.insurance_policies (created_at)
  where status = 'pending';

alter table public.insurance_policies enable row level security;

-- Owners read their own policies. Writes go through the service role only —
-- a client must never be able to mark its own policy active.
create policy insurance_policies_select_own
  on public.insurance_policies
  for select
  using (auth.uid() = user_id);
