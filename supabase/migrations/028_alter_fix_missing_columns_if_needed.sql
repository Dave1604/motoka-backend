-- =============================================
-- ALTER MIGRATION 028: Fix Missing Columns/Tables If Needed
-- =============================================
-- This migration checks for and adds any missing columns or tables that might
-- have been missed during initial migration runs.
-- 
-- This is an ALTER migration because migrations 001-025 have already been run
-- in production. This migration is idempotent and safe to run multiple times.
-- All operations use IF NOT EXISTS or IF EXISTS checks.
-- =============================================

-- =============================================
-- 1. Check and add webhook columns if missing (from migration 021)
-- =============================================

DO $$
BEGIN
  -- Add webhook_event_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'webhook_event_id'
  ) THEN
    ALTER TABLE public.payment_transactions 
    ADD COLUMN webhook_event_id VARCHAR(255);
  END IF;

  -- Add webhook_processed_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'webhook_processed_at'
  ) THEN
    ALTER TABLE public.payment_transactions 
    ADD COLUMN webhook_processed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create unique index to prevent duplicate event processing (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_id_unique 
ON public.payment_transactions(webhook_event_id) 
WHERE webhook_event_id IS NOT NULL;

-- Add index for webhook processing queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_webhook_processed_at 
ON public.payment_transactions(webhook_processed_at)
WHERE webhook_processed_at IS NOT NULL;

-- =============================================
-- 2. Check and create subscriptions table if missing (from migration 016)
-- =============================================

-- Subscription status enum (if not exists)
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'active',       -- Subscription is active and will auto-renew
    'paused',       -- Temporarily paused (user request)
    'cancelled',    -- Cancelled by user
    'expired',      -- Expired due to failed payments
    'pending'       -- Awaiting first successful payment
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Subscription plan enum (if not exists)
DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM (
    'annual',       -- 12-month renewal
    'biannual',     -- 6-month renewal
    'quarterly'     -- 3-month renewal
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Subscriptions Table (if not exists)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id BIGSERIAL PRIMARY KEY,
  subscription_code VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  car_id BIGINT NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  plan subscription_plan NOT NULL DEFAULT 'annual',
  status subscription_status NOT NULL DEFAULT 'pending',
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  billing_cycle_months INTEGER NOT NULL DEFAULT 12,
  next_billing_date DATE NOT NULL,
  last_billing_date DATE,
  authorization_code VARCHAR(100),
  card_type VARCHAR(50),
  card_last4 VARCHAR(4),
  card_exp_month VARCHAR(2),
  card_exp_year VARCHAR(4),
  card_bank VARCHAR(100),
  email VARCHAR(255) NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  last_transaction_id BIGINT REFERENCES public.payment_transactions(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for subscriptions (if not exists)
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_car_id ON public.subscriptions(car_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription_code ON public.subscriptions(subscription_code);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_billing 
  ON public.subscriptions(next_billing_date, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status 
  ON public.subscriptions(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active_per_car 
  ON public.subscriptions(car_id) 
  WHERE status = 'active';

-- Enable RLS on subscriptions (if not already enabled)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies (to ensure they're correct)
DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can create own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Service role full access on subscriptions" ON public.subscriptions;

CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions 
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own subscriptions"
  ON public.subscriptions 
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions 
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on subscriptions"
  ON public.subscriptions 
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at (if not exists)
DROP TRIGGER IF EXISTS trigger_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trigger_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- =============================================
-- 3. Check and create local_governments table if missing (from migration 023)
-- =============================================

CREATE TABLE IF NOT EXISTS local_governments (
  id SERIAL PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(state_id, name)
);

-- Create indexes for local_governments (if not exists)
CREATE INDEX IF NOT EXISTS idx_lgas_state_id ON local_governments(state_id);
CREATE INDEX IF NOT EXISTS idx_lgas_active ON local_governments(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_lgas_display_order ON local_governments(display_order) WHERE is_active = TRUE;

-- Enable RLS on local_governments (if not already enabled)
ALTER TABLE local_governments ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policy (to ensure it's correct)
DROP POLICY IF EXISTS "Anyone can view active local governments" ON local_governments;

CREATE POLICY "Anyone can view active local governments"
  ON local_governments FOR SELECT
  USING (is_active = TRUE);

-- Function to update updated_at timestamp (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at (if not exists)
DROP TRIGGER IF EXISTS update_local_governments_updated_at ON local_governments;
CREATE TRIGGER update_local_governments_updated_at
  BEFORE UPDATE ON local_governments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VERIFICATION QUERY (commented out - uncomment to verify)
-- =============================================
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN (
--   'payment_transactions',
--   'renewal_orders',
--   'subscriptions',
--   'renewal_items',
--   'states',
--   'local_governments'
-- )
-- ORDER BY table_name;
-- 
-- Expected result: 6 tables
-- =============================================
