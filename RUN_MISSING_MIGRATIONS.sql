-- =============================================
-- RUN MISSING MIGRATIONS
-- =============================================
-- Copy and paste this entire file into Supabase SQL Editor
-- Run it to create the missing tables: subscriptions and local_governments
-- =============================================

-- =============================================
-- MIGRATION 016: SUBSCRIPTION SYSTEM
-- =============================================

-- Subscription status enum
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

-- Subscription plan enum (extensible)
DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM (
    'annual',       -- 12-month renewal
    'biannual',     -- 6-month renewal
    'quarterly'     -- 3-month renewal
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Subscriptions Table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id BIGSERIAL PRIMARY KEY,
  subscription_code VARCHAR(100) UNIQUE NOT NULL,  -- Internal code (SUB-XXXXXX)
  
  -- References
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  car_id BIGINT NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  
  -- Subscription details
  plan subscription_plan NOT NULL DEFAULT 'annual',
  status subscription_status NOT NULL DEFAULT 'pending',
  amount DECIMAL(12, 2) NOT NULL,  -- Amount in kobo for each billing
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  
  -- Billing cycle
  billing_cycle_months INTEGER NOT NULL DEFAULT 12,
  next_billing_date DATE NOT NULL,
  last_billing_date DATE,
  
  -- Paystack authorization (for recurring charges)
  authorization_code VARCHAR(100),
  card_type VARCHAR(50),
  card_last4 VARCHAR(4),
  card_exp_month VARCHAR(2),
  card_exp_year VARCHAR(4),
  card_bank VARCHAR(100),
  email VARCHAR(255) NOT NULL,  -- Customer email for Paystack
  
  -- Retry logic for failed payments
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  
  -- Related transaction tracking
  last_transaction_id BIGINT REFERENCES public.payment_transactions(id),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Lifecycle timestamps
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_car_id ON public.subscriptions(car_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription_code ON public.subscriptions(subscription_code);

-- Index for cron job: find subscriptions due for billing
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_billing 
  ON public.subscriptions(next_billing_date, status)
  WHERE status = 'active';

-- Composite index for user subscription queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status 
  ON public.subscriptions(user_id, status);

-- Partial unique index: only one active subscription per car
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active_per_car 
  ON public.subscriptions(car_id) 
  WHERE status = 'active';

-- Enable Row Level Security
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can create own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Service role full access on subscriptions" ON public.subscriptions;

-- Users can view their own subscriptions
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions 
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create subscriptions for themselves
CREATE POLICY "Users can create own subscriptions"
  ON public.subscriptions 
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own subscriptions (pause/cancel)
CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions 
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access (for cron job processing)
CREATE POLICY "Service role full access on subscriptions"
  ON public.subscriptions 
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trigger_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Helper Functions
CREATE OR REPLACE FUNCTION public.has_active_subscription(p_car_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE car_id = p_car_id 
      AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_subscriptions_due_for_billing(p_days_ahead INTEGER DEFAULT 30)
RETURNS SETOF public.subscriptions AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.subscriptions
  WHERE status = 'active'
    AND next_billing_date <= (CURRENT_DATE + p_days_ahead)
    AND authorization_code IS NOT NULL
  ORDER BY next_billing_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- MIGRATION 021: WEBHOOK EVENT TRACKING
-- =============================================
-- Add webhook event tracking columns to payment_transactions table

ALTER TABLE public.payment_transactions 
ADD COLUMN IF NOT EXISTS webhook_event_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS webhook_processed_at TIMESTAMPTZ;

-- Create unique index to prevent duplicate event processing
DROP INDEX IF EXISTS idx_webhook_event_id_unique;
CREATE UNIQUE INDEX idx_webhook_event_id_unique 
ON public.payment_transactions(webhook_event_id) 
WHERE webhook_event_id IS NOT NULL;

-- Add index for webhook processing queries (for monitoring and debugging)
CREATE INDEX IF NOT EXISTS idx_webhook_processed_at 
ON public.payment_transactions(webhook_processed_at)
WHERE webhook_processed_at IS NOT NULL;

-- Add comments explaining the purpose
COMMENT ON COLUMN public.payment_transactions.webhook_event_id IS 
'Paystack webhook event ID - used to prevent replay attacks by ensuring each webhook event is only processed once';

COMMENT ON COLUMN public.payment_transactions.webhook_processed_at IS 
'Timestamp when webhook was processed - used for monitoring and debugging webhook processing';

-- =============================================
-- MIGRATION 023: STATES AND LGAS (PARTIAL - local_governments table only)
-- =============================================
-- Note: states table already exists, we just need local_governments

-- Create local governments table
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lgas_state_id ON local_governments(state_id);
CREATE INDEX IF NOT EXISTS idx_lgas_active ON local_governments(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_lgas_display_order ON local_governments(display_order) WHERE is_active = TRUE;

-- Add comments for documentation
COMMENT ON TABLE local_governments IS 'Local government areas (LGAs) for each state';
COMMENT ON COLUMN local_governments.is_active IS 'Whether the LGA is currently active/available';

-- Enable Row Level Security (RLS)
ALTER TABLE local_governments ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Anyone can view active local governments" ON local_governments;

-- RLS Policy: Allow public read access for active LGAs
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

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_local_governments_updated_at ON local_governments;
CREATE TRIGGER update_local_governments_updated_at
  BEFORE UPDATE ON local_governments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Run this after to verify all tables exist:

SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'payment_transactions',
  'renewal_orders',
  'subscriptions',
  'renewal_items',
  'states',
  'local_governments'
)
ORDER BY table_name;

-- Expected result: 6 tables
-- If you see all 6, migrations are complete! ✅
