-- =============================================
-- Migration 038: Payment idempotency and audit logging
-- =============================================

-- Idempotency keys for payment initialization (prevents duplicate charges on double-click)
CREATE TABLE IF NOT EXISTS public.payment_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id BIGINT REFERENCES public.payment_transactions(id),
  status VARCHAR(20) NOT NULL DEFAULT 'processing', -- processing | completed | failed
  response_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_idempotency_created_at ON public.payment_idempotency(created_at DESC);

COMMENT ON TABLE public.payment_idempotency IS 'Stores idempotency keys for payment init to prevent duplicate charges. Keys expire after 24h (cleanup via cron or application logic).';

-- Payment audit log for compliance and debugging
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL, -- init | verify | webhook_success | webhook_failed | refund | status_change
  transaction_id BIGINT REFERENCES public.payment_transactions(id),
  reference VARCHAR(100),
  user_id UUID REFERENCES auth.users(id),
  payment_gateway VARCHAR(20),
  amount_kobo BIGINT,
  status_before VARCHAR(20),
  status_after VARCHAR(20),
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_audit_log_transaction ON public.payment_audit_log(transaction_id);
CREATE INDEX idx_payment_audit_log_reference ON public.payment_audit_log(reference);
CREATE INDEX idx_payment_audit_log_created_at ON public.payment_audit_log(created_at DESC);
CREATE INDEX idx_payment_audit_log_event_type ON public.payment_audit_log(event_type);

COMMENT ON TABLE public.payment_audit_log IS 'Audit trail for payment events. Retain for compliance (e.g. PCI, financial reporting).';
