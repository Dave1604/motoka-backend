-- Deferred document reminders for partial renewals
-- Stores both expiry-based reminders and post-skip nudges

CREATE TABLE IF NOT EXISTS public.deferred_document_reminders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_email VARCHAR(255),
  car_id BIGINT REFERENCES public.cars(id) ON DELETE CASCADE,
  plate_number VARCHAR(20),
  document_name VARCHAR(100) NOT NULL,
  expiry_date DATE,
  reason VARCHAR(20) NOT NULL DEFAULT 'skipped',
  custom_reason TEXT,
  notified_30_days BOOLEAN NOT NULL DEFAULT FALSE,
  notified_14_days BOOLEAN NOT NULL DEFAULT FALSE,
  notified_7_days BOOLEAN NOT NULL DEFAULT FALSE,
  notified_1_day BOOLEAN NOT NULL DEFAULT FALSE,
  nudge_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  nudge_48h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  nudge_72h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deferred_reminders_reason_check
    CHECK (reason IN ('skipped', 'not_expired', 'already_handled', 'custom')),
  CONSTRAINT deferred_reminders_owner_check
    CHECK (
      (user_id IS NOT NULL AND guest_email IS NULL)
      OR (user_id IS NULL AND guest_email IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_deferred_reminders_user_id
  ON public.deferred_document_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_deferred_reminders_car_id
  ON public.deferred_document_reminders(car_id);
CREATE INDEX IF NOT EXISTS idx_deferred_reminders_guest_email
  ON public.deferred_document_reminders(guest_email);
CREATE INDEX IF NOT EXISTS idx_deferred_reminders_expiry_date
  ON public.deferred_document_reminders(expiry_date);
CREATE INDEX IF NOT EXISTS idx_deferred_reminders_reason
  ON public.deferred_document_reminders(reason);
CREATE INDEX IF NOT EXISTS idx_deferred_reminders_created_at
  ON public.deferred_document_reminders(created_at DESC);

ALTER TABLE public.deferred_document_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deferred reminders"
  ON public.deferred_document_reminders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access deferred reminders"
  ON public.deferred_document_reminders FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
