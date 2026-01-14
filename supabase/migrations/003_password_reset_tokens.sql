-- =============================================
-- PASSWORD RESET TOKENS TABLE
-- For custom OTP-based password reset
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  email VARCHAR(255) PRIMARY KEY,
  otp VARCHAR(6),
  token VARCHAR(255),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON public.password_reset_tokens(expires_at);

-- Enable RLS
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can access (backend operations only)
CREATE POLICY "Service role only" 
  ON public.password_reset_tokens 
  FOR ALL 
  TO service_role 
  USING (true)
  WITH CHECK (true);

-- Function to clean up expired tokens (run via pg_cron or manually)
CREATE OR REPLACE FUNCTION public.cleanup_expired_password_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM public.password_reset_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

