-- =============================================
-- Migration 032: Fix pending order uniqueness constraint
-- =============================================
-- The original constraint prevented ANY two pending orders for the
-- same car. This is too strict — a plate_number application and a
-- renewal should be allowed to coexist.
--
-- Fix: scope the uniqueness to renewal-type orders only.
-- =============================================

-- Drop the old overly-broad constraint
DROP INDEX IF EXISTS public.idx_renewal_orders_car_pending_unique;

-- Recreate scoped only to renewal order types
-- (plate_number orders do not block renewals and vice-versa)
CREATE UNIQUE INDEX idx_renewal_orders_car_renewal_pending_unique
  ON public.renewal_orders (car_id)
  WHERE status IN ('pending', 'processing')
    AND order_type IN ('renewal_manual', 'renewal_auto', 'new_registration');

-- =============================================
-- Clean up stale pending orders that were
-- created with the wrong order_type before the
-- plate_number enum fix was applied.
-- These are safe to cancel because the RPC
-- previously failed and no real work was done.
-- =============================================
UPDATE public.renewal_orders
SET status = 'cancelled',
    cancelled_at = NOW(),
    rejection_reason = 'Cancelled: stale order from failed payment attempt (order_type mismatch)'
WHERE status IN ('pending', 'processing')
  AND order_type = 'renewal_manual'
  AND metadata->>'payment_type' = 'plate_number';
