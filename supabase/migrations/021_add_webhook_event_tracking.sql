-- =============================================
-- WEBHOOK EVENT TRACKING
-- Migration 021: Add webhook event ID tracking for replay attack protection
-- =============================================

-- Add webhook event tracking columns to payment_transactions table
ALTER TABLE public.payment_transactions 
ADD COLUMN IF NOT EXISTS webhook_event_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS webhook_processed_at TIMESTAMPTZ;

-- Create unique index to prevent duplicate event processing
-- This ensures the same webhook event ID cannot be processed twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_id_unique 
ON public.payment_transactions(webhook_event_id) 
WHERE webhook_event_id IS NOT NULL;

-- Add index for webhook processing queries (for monitoring and debugging)
CREATE INDEX IF NOT EXISTS idx_webhook_processed_at 
ON public.payment_transactions(webhook_processed_at)
WHERE webhook_processed_at IS NOT NULL;

-- Add comment explaining the purpose
COMMENT ON COLUMN public.payment_transactions.webhook_event_id IS 
'Paystack webhook event ID - used to prevent replay attacks by ensuring each webhook event is only processed once';

COMMENT ON COLUMN public.payment_transactions.webhook_processed_at IS 
'Timestamp when webhook was processed - used for monitoring and debugging webhook processing';
