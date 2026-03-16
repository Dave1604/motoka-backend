-- =============================================
-- STEP 2: Handle enum value rename from 'moniecredit' to 'monicredit'
-- Run this AFTER running 026_add_moniecredit_support.sql
-- =============================================

-- Step 2a: Add 'monicredit' value to payment_gateway enum type (if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'monicredit' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_gateway')
  ) THEN
    ALTER TYPE payment_gateway ADD VALUE 'monicredit';
  END IF;
END $$;

-- Step 2b: Update existing 'moniecredit' values to 'monicredit'
-- This will only work if 'monicredit' enum value exists
UPDATE public.payment_transactions
SET payment_gateway = 'monicredit'::payment_gateway
WHERE payment_gateway::text = 'moniecredit';

-- Note: PostgreSQL doesn't support removing enum values directly.
-- The old 'moniecredit' enum value will remain but won't be used.
-- All existing and new transactions will use 'monicredit'.
