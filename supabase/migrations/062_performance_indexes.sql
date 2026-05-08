-- =============================================
-- Migration 062: Performance indexes
-- Eliminates slow sequential scans on hot paths
-- =============================================

-- Stale-transaction cleanup in payment-init:
-- WHERE car_id = ? AND user_id = ? AND status = 'pending'
CREATE INDEX IF NOT EXISTS idx_payment_transactions_car_user_status
  ON public.payment_transactions(car_id, user_id, status)
  WHERE status = 'pending';

-- Driver-license stale-transaction cleanup:
-- WHERE user_id = ? AND payment_type = 'driver_license' AND car_id IS NULL AND status = 'pending'
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_type_status
  ON public.payment_transactions(user_id, payment_type, status)
  WHERE car_id IS NULL AND status = 'pending';

-- Location service — states lookup by code (used in renewal + Ladipo delivery)
CREATE INDEX IF NOT EXISTS idx_states_code_active
  ON public.states(code)
  WHERE is_active = true;

-- Location service — LGA lookup by state_id (second query in getLGAsByState)
CREATE INDEX IF NOT EXISTS idx_local_governments_state_active
  ON public.local_governments(state_id)
  WHERE is_active = true;

-- Ladipo orders — user orders list (hot path for authenticated users)
CREATE INDEX IF NOT EXISTS idx_ladipo_orders_user_created
  ON public.ladipo_orders(user_id, created_at DESC);

-- Ladipo orders — payment fulfillment via webhook reference lookup
CREATE INDEX IF NOT EXISTS idx_ladipo_orders_paystack_reference
  ON public.ladipo_orders(paystack_reference)
  WHERE paystack_reference IS NOT NULL;
