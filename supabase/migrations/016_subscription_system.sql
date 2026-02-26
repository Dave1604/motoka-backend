-- =============================================
-- SUBSCRIPTION SYSTEM
-- Migration 016: Recurring payment subscriptions
-- =============================================

-- Subscription status enum
CREATE TYPE subscription_status AS ENUM (
  'active',       -- Subscription is active and will auto-renew
  'paused',       -- Temporarily paused (user request)
  'cancelled',    -- Cancelled by user
  'expired',      -- Expired due to failed payments
  'pending'       -- Awaiting first successful payment
);

-- Subscription plan enum (extensible)
CREATE TYPE subscription_plan AS ENUM (
  'annual',       -- 12-month renewal
  'biannual',     -- 6-month renewal
  'quarterly'     -- 3-month renewal
);

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
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_car_id ON public.subscriptions(car_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX idx_subscriptions_subscription_code ON public.subscriptions(subscription_code);

-- Index for cron job: find subscriptions due for billing
CREATE INDEX idx_subscriptions_active_billing 
  ON public.subscriptions(next_billing_date, status)
  WHERE status = 'active';

-- Composite index for user subscription queries
CREATE INDEX idx_subscriptions_user_status 
  ON public.subscriptions(user_id, status);

-- Partial unique index: only one active subscription per car
CREATE UNIQUE INDEX idx_subscriptions_unique_active_per_car 
  ON public.subscriptions(car_id) 
  WHERE status = 'active';

-- Enable Row Level Security
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

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
CREATE TRIGGER trigger_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to check if a car has an active subscription
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

-- Function to get subscriptions due for billing within N days
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

