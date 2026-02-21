-- =============================================
-- RENEWAL ORDERS SYSTEM
-- Migration 017: Admin order processing workflow
-- =============================================

-- Order status enum
CREATE TYPE order_status AS ENUM (
  'pending',      -- Awaiting admin processing (newly created)
  'processing',   -- Admin has started processing
  'completed',    -- Admin finished, expiry extended
  'cancelled'     -- Order cancelled (payment refunded)
);

-- Order type enum
CREATE TYPE order_type AS ENUM (
  'renewal_manual',       -- One-time manual renewal
  'renewal_auto',         -- Subscription auto-renewal
  'new_registration'      -- New car registration (future)
);

-- Renewal Orders Table
CREATE TABLE IF NOT EXISTS public.renewal_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,  -- Format: ORD-YYYYMMDD-XXXXX
  
  -- References
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  car_id BIGINT NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL REFERENCES public.payment_transactions(id),
  subscription_id BIGINT REFERENCES public.subscriptions(id),  -- NULL for manual renewals
  
  -- Order details
  order_type order_type NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  amount_paid DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  
  -- Renewal details
  renewal_months INTEGER NOT NULL DEFAULT 12,
  previous_expiry_date DATE,  -- Snapshot of expiry before renewal
  new_expiry_date DATE,       -- Set when order is completed
  
  -- Admin assignment and processing
  assigned_to UUID REFERENCES auth.users(id),  -- Admin user ID
  processing_notes TEXT,       -- Admin notes during processing
  completion_notes TEXT,       -- Final notes on completion
  rejection_reason TEXT,       -- If cancelled, why
  
  -- Document tracking (uploaded by admin during processing)
  documents_uploaded JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Lifecycle timestamps
  assigned_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_renewal_orders_user_id ON public.renewal_orders(user_id);
CREATE INDEX idx_renewal_orders_car_id ON public.renewal_orders(car_id);
CREATE INDEX idx_renewal_orders_transaction_id ON public.renewal_orders(transaction_id);
CREATE INDEX idx_renewal_orders_subscription_id ON public.renewal_orders(subscription_id);
CREATE INDEX idx_renewal_orders_status ON public.renewal_orders(status);
CREATE INDEX idx_renewal_orders_order_number ON public.renewal_orders(order_number);
CREATE INDEX idx_renewal_orders_assigned_to ON public.renewal_orders(assigned_to);
CREATE INDEX idx_renewal_orders_created_at ON public.renewal_orders(created_at DESC);

-- Composite index for admin dashboard queries
CREATE INDEX idx_renewal_orders_status_created 
  ON public.renewal_orders(status, created_at DESC);

-- Index for assigned admin orders
CREATE INDEX idx_renewal_orders_assigned_status 
  ON public.renewal_orders(assigned_to, status)
  WHERE assigned_to IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.renewal_orders ENABLE ROW LEVEL SECURITY;

-- Users can view their own orders
CREATE POLICY "Users can view own orders"
  ON public.renewal_orders 
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access (for admin operations)
CREATE POLICY "Service role full access on orders"
  ON public.renewal_orders 
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER trigger_renewal_orders_updated_at
  BEFORE UPDATE ON public.renewal_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to generate order number
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS VARCHAR AS $$
DECLARE
  v_date_part VARCHAR;
  v_seq_part VARCHAR;
  v_count INTEGER;
BEGIN
  -- Format: ORD-YYYYMMDD-XXXXX
  v_date_part := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  
  -- Count orders created today
  SELECT COUNT(*) + 1 INTO v_count
  FROM public.renewal_orders
  WHERE DATE(created_at) = CURRENT_DATE;
  
  -- Pad sequence to 5 digits
  v_seq_part := LPAD(v_count::VARCHAR, 5, '0');
  
  RETURN 'ORD-' || v_date_part || '-' || v_seq_part;
END;
$$ LANGUAGE plpgsql;

-- Function to get pending orders count (for admin dashboard)
CREATE OR REPLACE FUNCTION public.get_pending_orders_count()
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*) FROM public.renewal_orders
    WHERE status = 'pending'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get orders by status with pagination
CREATE OR REPLACE FUNCTION public.get_orders_by_status(
  p_status order_status,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF public.renewal_orders AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.renewal_orders
  WHERE status = p_status
  ORDER BY created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

