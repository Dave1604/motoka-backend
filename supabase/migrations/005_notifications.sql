-- =============================================
-- NOTIFICATIONS TABLE
-- Uses user_id (VARCHAR 6-char) for legacy compatibility
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(6) NOT NULL,  -- References profiles.user_id (NOT auth.users.id)
  type VARCHAR(255) NOT NULL,   -- 'car', 'license', 'profile', 'payment', etc.
  action VARCHAR(255) NOT NULL, -- 'created', 'updated', 'deleted', 'approved', etc.
  message TEXT NOT NULL,
  data JSONB,                   -- Additional data
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications (need to join with profiles)
CREATE POLICY "Users can view own notifications" 
  ON public.notifications 
  FOR SELECT 
  TO authenticated 
  USING (
    user_id IN (
      SELECT p.user_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications" 
  ON public.notifications 
  FOR UPDATE 
  TO authenticated 
  USING (
    user_id IN (
      SELECT p.user_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Service role has full access
CREATE POLICY "Service role has full access" 
  ON public.notifications 
  FOR ALL 
  TO service_role 
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS on_notifications_updated ON public.notifications;
CREATE TRIGGER on_notifications_updated
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

