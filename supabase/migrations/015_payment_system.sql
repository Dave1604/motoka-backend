-- =============================================
-- PAYMENT SYSTEM TABLES
-- Migration 015: Core payment infrastructure
-- =============================================

-- Payment status enum
CREATE TYPE payment_status AS ENUM (
  'pending',      -- Payment initialized, awaiting completion
  'successful',   -- Payment confirmed via webhook
  'failed',       -- Payment failed
  'abandoned',    -- User abandoned payment flow
  'refunded'      -- Payment was refunded
);

-- Payment type enum
CREATE TYPE payment_type AS ENUM (
  'renewal_manual',      -- One-time manual renewal payment
  'renewal_auto',        -- Subscription-based auto-renewal
  'new_registration'     -- Payment for new car registration (future)
);

-- Payment Transactions Table
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(100) UNIQUE NOT NULL,  -- Internal unique reference
  
  -- User and car references
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  car_id BIGINT REFERENCES public.cars(id) ON DELETE SET NULL,
  
  -- Payment details (variable pricing)
  amount DECIMAL(12, 2) NOT NULL,  -- Amount in kobo
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  payment_type payment_type NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  
  -- Paystack-specific fields
  paystack_reference VARCHAR(100),        -- Paystack's reference
  paystack_access_code VARCHAR(100),      -- Access code for payment page
  authorization_code VARCHAR(100),        -- For recurring charges (subscriptions)
  channel VARCHAR(50),                    -- card, bank, ussd, etc.
  
  -- Payment timestamps
  paid_at TIMESTAMPTZ,
  
  -- Metadata for flexibility
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_payment_transactions_user_id ON public.payment_transactions(user_id);
CREATE INDEX idx_payment_transactions_car_id ON public.payment_transactions(car_id);
CREATE INDEX idx_payment_transactions_reference ON public.payment_transactions(reference);
CREATE INDEX idx_payment_transactions_paystack_reference ON public.payment_transactions(paystack_reference);
CREATE INDEX idx_payment_transactions_status ON public.payment_transactions(status);
CREATE INDEX idx_payment_transactions_payment_type ON public.payment_transactions(payment_type);
CREATE INDEX idx_payment_transactions_created_at ON public.payment_transactions(created_at DESC);

-- Composite index for user payment history queries
CREATE INDEX idx_payment_transactions_user_status_created 
  ON public.payment_transactions(user_id, status, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own payment transactions
CREATE POLICY "Users can view own payments"
  ON public.payment_transactions 
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access (for webhook processing)
CREATE POLICY "Service role full access on payments"
  ON public.payment_transactions 
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER trigger_payment_transactions_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to check if a payment reference already exists
CREATE OR REPLACE FUNCTION public.payment_reference_exists(p_reference VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE reference = p_reference
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get transaction by reference (for webhook processing)
CREATE OR REPLACE FUNCTION public.get_transaction_by_reference(p_reference VARCHAR)
RETURNS SETOF public.payment_transactions AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.payment_transactions
  WHERE reference = p_reference
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

