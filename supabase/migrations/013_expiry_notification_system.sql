-- Notification History & Error Tracking Tables
-- Prevents duplicate emails and tracks all notifications

CREATE TABLE IF NOT EXISTS public.expiry_notification_history (
  id BIGSERIAL PRIMARY KEY,
  car_id BIGINT NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type VARCHAR(20) NOT NULL,
  expiry_date DATE NOT NULL,
  email_sent_to VARCHAR(255) NOT NULL,
  email_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resend_email_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_car_notification_type_expiry UNIQUE (car_id, notification_type, expiry_date)
);

CREATE INDEX IF NOT EXISTS idx_notification_history_car_id ON public.expiry_notification_history(car_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_user_id ON public.expiry_notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_type_date ON public.expiry_notification_history(notification_type, expiry_date);
CREATE INDEX IF NOT EXISTS idx_notification_history_sent_at ON public.expiry_notification_history(email_sent_at DESC);

ALTER TABLE public.expiry_notification_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification history"
  ON public.expiry_notification_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON public.expiry_notification_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.expiry_notification_errors (
  id BIGSERIAL PRIMARY KEY,
  car_id BIGINT,
  user_id UUID,
  notification_type VARCHAR(20),
  error_code VARCHAR(50) NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  function_name VARCHAR(100),
  execution_id VARCHAR(100),
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_errors_car_id ON public.expiry_notification_errors(car_id);
CREATE INDEX IF NOT EXISTS idx_notification_errors_created_at ON public.expiry_notification_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_errors_unresolved ON public.expiry_notification_errors(resolved_at) WHERE resolved_at IS NULL;

ALTER TABLE public.expiry_notification_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access errors"
  ON public.expiry_notification_errors FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Helper function for idempotency checks
CREATE OR REPLACE FUNCTION public.check_notification_sent(
  p_car_id BIGINT,
  p_notification_type VARCHAR(20),
  p_expiry_date DATE
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.expiry_notification_history
    WHERE car_id = p_car_id
      AND notification_type = p_notification_type
      AND expiry_date = p_expiry_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
