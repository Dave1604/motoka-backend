-- One-off data step (NOT a migration). Run in the Supabase SQL editor after
-- migration 108. Flags rows that were never real revenue so the admin
-- dashboard and payments page stop counting them. Never delete payment rows.
-- Source: revenue audit 2026-10-16.

BEGIN;

-- Demo-account test payments.
--   316  wallet.demo@example.com  ₦37,000  renewal (order cancelled)
--   312  wallet.demo@example.com  ₦5,178   wallet funding
UPDATE public.payment_transactions
   SET is_test = true
 WHERE id IN (316, 312)
   AND is_test = false;

-- CORRECTION 2026-10-16 15:50: tx 168 (tescointsite@gmail.com, ₦550,000
-- customised plate, ORD-20260312-A1C8B9, completed) was flagged as a test in
-- the 13:50 run because the profile has is_admin = true. Dave confirmed it is
-- a real customer payment (marked paid manually by admin on 2026-03-12).
-- Run this on its own to undo that flag:
UPDATE public.payment_transactions
   SET is_test = false
 WHERE id = 168;

-- Duplicate charges from the May 2026 incident: mkoalive@yahoo.com was
-- charged 3x ₦5,000 within 90 seconds for one renewal. Only tx 258 created
-- the order; 257 and 259 are duplicates and ₦10,000 refund is still owed.
UPDATE public.payment_transactions
   SET cancellation_reason = 'duplicate_charge'
 WHERE id IN (257, 259)
   AND cancellation_reason IS NULL;

-- Verify before COMMIT: expect 2 rows is_test (312, 316), 2 rows duplicate_charge (257, 259), 168 is_test = false.
SELECT id, amount / 100 AS naira, status, is_test, cancellation_reason
  FROM public.payment_transactions
 WHERE id IN (168, 316, 312, 257, 258, 259)
 ORDER BY id;

COMMIT;

-- PENDING the boss's answer (rakiorasak@gmail.com). Do not run until he says
-- which of these were tests:
--   tx 341  ₦3,500   renewal 2026-10-08 (successful)
--   tx 320  ₦1,015   wallet funding 2026-07-29
--   tx 155  ₦34,500  renewal 2026-03-03
--   guest order ₦3,500 2026-09-21 (guest_renewal_orders, email rakiorasak@gmail.com)
-- UPDATE public.payment_transactions SET is_test = true WHERE id IN (...);
-- UPDATE public.guest_renewal_orders SET is_test = true WHERE email = 'rakiorasak@gmail.com' AND total_amount = 350000;
