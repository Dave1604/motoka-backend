-- =============================================
-- EXPIRY NOTIFICATIONS TRACKING TABLE
-- Tracks which notifications have been sent to avoid duplicates
-- =============================================

CREATE TABLE IF NOT EXISTS public.expiry_notifications (
  id BIGSERIAL PRIMARY KEY,
  car_id BIGINT NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type VARCHAR(20) NOT NULL CHECK (notification_type IN ('30_days', '14_days', '7_days', '3_days', '2_days', '1_day')),
  expiry_date DATE NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  email_id VARCHAR(255), -- Resend email ID for tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(car_id, notification_type, expiry_date) -- Prevent duplicate notifications
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_expiry_notifications_car_id ON public.expiry_notifications(car_id);
CREATE INDEX IF NOT EXISTS idx_expiry_notifications_user_id ON public.expiry_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_expiry_notifications_sent_at ON public.expiry_notifications(sent_at);
CREATE INDEX IF NOT EXISTS idx_expiry_notifications_lookup ON public.expiry_notifications(car_id, notification_type, expiry_date);

-- Add index to cars table for efficient expiry date queries
CREATE INDEX IF NOT EXISTS idx_cars_expiry_date ON public.cars(expiry_date) WHERE expiry_date IS NOT NULL AND deleted_at IS NULL AND status = 'approved';

-- Enable RLS
ALTER TABLE public.expiry_notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own expiry notifications" 
  ON public.expiry_notifications 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = user_id);

-- Service role has full access (for cron jobs)
CREATE POLICY "Service role has full access to expiry notifications" 
  ON public.expiry_notifications 
  FOR ALL 
  TO service_role 
  USING (true)
  WITH CHECK (true);

-- Function to clean up old notifications (optional, can be run periodically)
CREATE OR REPLACE FUNCTION public.cleanup_old_expiry_notifications()
RETURNS void AS $$
BEGIN
  -- Delete notifications older than 6 months
  DELETE FROM public.expiry_notifications
  WHERE sent_at < NOW() - INTERVAL '6 months';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.expiry_notifications IS 'Tracks which expiry reminder emails have been sent to prevent duplicates';
COMMENT ON COLUMN public.expiry_notifications.notification_type IS 'Type of notification: 30_days, 14_days, 7_days, 3_days, 2_days, 1_day';
COMMENT ON COLUMN public.expiry_notifications.email_id IS 'Resend email ID for delivery tracking';
