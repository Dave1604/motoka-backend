-- =============================================
-- Migration 045: Guest Renewal System
-- Creates guest_customers and guest_renewal_orders tables
-- for the unauthenticated renewal flow.
-- =============================================

-- Guest customers: lightweight unauthenticated customer record
CREATE TABLE IF NOT EXISTS public.guest_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  plate_number VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guest_customers_email ON public.guest_customers(email);
CREATE INDEX idx_guest_customers_plate_number ON public.guest_customers(plate_number);

-- Guest renewal orders: tracks the full lifecycle of a guest renewal attempt
CREATE TABLE IF NOT EXISTS public.guest_renewal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Guest identity (denormalised for ease of querying without join)
  guest_customer_id UUID NOT NULL REFERENCES public.guest_customers(id) ON DELETE CASCADE,
  guest_name VARCHAR(255) NOT NULL,
  guest_email VARCHAR(255) NOT NULL,
  guest_phone VARCHAR(20) NOT NULL,

  -- Vehicle info
  plate_number VARCHAR(20) NOT NULL,
  expiry_date DATE NOT NULL,

  -- Selected renewal items (array of item_keys)
  selected_items JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Pricing breakdown (all in kobo)
  renewal_amount BIGINT NOT NULL DEFAULT 0,
  delivery_fee BIGINT NOT NULL DEFAULT 0,
  total_amount BIGINT NOT NULL DEFAULT 0,

  -- Delivery details (null when no delivery requested)
  delivery_details JSONB DEFAULT NULL,

  -- Payment info
  payment_gateway VARCHAR(20) NOT NULL DEFAULT 'monicredit',
  payment_reference VARCHAR(100) UNIQUE,
  payment_url TEXT,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending_payment',
  -- payment_status values: pending_payment, payment_success, payment_failed, expired

  -- Receipt token: short-lived token sent in response and used to access receipt/signup
  receipt_token VARCHAR(100) UNIQUE,

  -- Post-payment account linkage: set once the guest signs up after payment
  linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Order expiry (guests get 24h to complete payment)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guest_renewal_orders_guest_customer_id ON public.guest_renewal_orders(guest_customer_id);
CREATE INDEX idx_guest_renewal_orders_payment_reference ON public.guest_renewal_orders(payment_reference);
CREATE INDEX idx_guest_renewal_orders_receipt_token ON public.guest_renewal_orders(receipt_token);
CREATE INDEX idx_guest_renewal_orders_linked_user_id ON public.guest_renewal_orders(linked_user_id);
CREATE INDEX idx_guest_renewal_orders_payment_status ON public.guest_renewal_orders(payment_status);

-- Auto-update updated_at on guest_customers
CREATE OR REPLACE FUNCTION public.set_guest_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guest_customers_updated_at
  BEFORE UPDATE ON public.guest_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_guest_customers_updated_at();

-- Auto-update updated_at on guest_renewal_orders
CREATE OR REPLACE FUNCTION public.set_guest_renewal_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guest_renewal_orders_updated_at
  BEFORE UPDATE ON public.guest_renewal_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_guest_renewal_orders_updated_at();

-- Disable RLS on guest tables (accessed only via service role from backend)
ALTER TABLE public.guest_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_renewal_orders ENABLE ROW LEVEL SECURITY;

-- Service role has full access; anon/authenticated users have none
CREATE POLICY "service_role_full_access_guest_customers"
  ON public.guest_customers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_full_access_guest_renewal_orders"
  ON public.guest_renewal_orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.guest_customers IS
'Lightweight unauthenticated customer records created during the guest renewal flow.';

COMMENT ON TABLE public.guest_renewal_orders IS
'Tracks the full lifecycle of a guest (unauthenticated) vehicle document renewal attempt: from payment init through account creation.';
