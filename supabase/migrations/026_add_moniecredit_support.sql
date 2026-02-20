-- =============================================
-- ADD MONICREDIT PAYMENT GATEWAY SUPPORT
-- Migration 026: Add payment gateway selection and Monicredit fields
-- =============================================

-- STEP 1: Create enum type if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_gateway') THEN
    CREATE TYPE payment_gateway AS ENUM ('paystack', 'monicredit');
  END IF;
END $$;

-- STEP 2: Handle enum value - add 'monicredit' if it doesn't exist
-- Note: PostgreSQL doesn't support renaming enum values directly
-- The enum value addition must be done separately (see STEP2 file)
-- After adding 'monicredit', update existing 'moniecredit' values in STEP2

-- STEP 3: Add payment_gateway column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'payment_gateway'
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD COLUMN payment_gateway payment_gateway DEFAULT 'paystack';
  END IF;
END $$;

-- STEP 4: Rename existing Moniecredit columns to Monicredit
-- Check if old columns exist and rename them, otherwise add new columns
-- If target column already exists, drop the old column instead
DO $$
BEGIN
  -- Handle moniecredit_order_id -> monicredit_order_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'moniecredit_order_id'
  ) THEN
    -- If target column exists, drop old column; otherwise rename
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'payment_transactions' 
      AND column_name = 'monicredit_order_id'
    ) THEN
      ALTER TABLE public.payment_transactions
        DROP COLUMN moniecredit_order_id;
    ELSE
      ALTER TABLE public.payment_transactions
        RENAME COLUMN moniecredit_order_id TO monicredit_order_id;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'monicredit_order_id'
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD COLUMN monicredit_order_id VARCHAR(100);
  END IF;

  -- Handle moniecredit_transaction_id -> monicredit_transaction_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'moniecredit_transaction_id'
  ) THEN
    -- If target column exists, drop old column; otherwise rename
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'payment_transactions' 
      AND column_name = 'monicredit_transaction_id'
    ) THEN
      ALTER TABLE public.payment_transactions
        DROP COLUMN moniecredit_transaction_id;
    ELSE
      ALTER TABLE public.payment_transactions
        RENAME COLUMN moniecredit_transaction_id TO monicredit_transaction_id;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'monicredit_transaction_id'
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD COLUMN monicredit_transaction_id VARCHAR(100);
  END IF;

  -- Handle moniecredit_account_number -> monicredit_account_number
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'moniecredit_account_number'
  ) THEN
    -- If target column exists, drop old column; otherwise rename
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'payment_transactions' 
      AND column_name = 'monicredit_account_number'
    ) THEN
      ALTER TABLE public.payment_transactions
        DROP COLUMN moniecredit_account_number;
    ELSE
      ALTER TABLE public.payment_transactions
        RENAME COLUMN moniecredit_account_number TO monicredit_account_number;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'monicredit_account_number'
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD COLUMN monicredit_account_number VARCHAR(20);
  END IF;

  -- Handle moniecredit_bank_name -> monicredit_bank_name
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'moniecredit_bank_name'
  ) THEN
    -- If target column exists, drop old column; otherwise rename
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'payment_transactions' 
      AND column_name = 'monicredit_bank_name'
    ) THEN
      ALTER TABLE public.payment_transactions
        DROP COLUMN moniecredit_bank_name;
    ELSE
      ALTER TABLE public.payment_transactions
        RENAME COLUMN moniecredit_bank_name TO monicredit_bank_name;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'monicredit_bank_name'
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD COLUMN monicredit_bank_name VARCHAR(100);
  END IF;

  -- Handle moniecredit_account_name -> monicredit_account_name
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'moniecredit_account_name'
  ) THEN
    -- If target column exists, drop old column; otherwise rename
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'payment_transactions' 
      AND column_name = 'monicredit_account_name'
    ) THEN
      ALTER TABLE public.payment_transactions
        DROP COLUMN moniecredit_account_name;
    ELSE
      ALTER TABLE public.payment_transactions
        RENAME COLUMN moniecredit_account_name TO monicredit_account_name;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'payment_transactions' 
    AND column_name = 'monicredit_account_name'
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD COLUMN monicredit_account_name VARCHAR(200);
  END IF;
END $$;

-- STEP 5: Drop old indexes if they exist and create new ones
DROP INDEX IF EXISTS idx_payment_transactions_moniecredit_order_id;
DROP INDEX IF EXISTS idx_payment_transactions_moniecredit_transaction_id;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_gateway 
  ON public.payment_transactions(payment_gateway);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_monicredit_order_id 
  ON public.payment_transactions(monicredit_order_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_monicredit_transaction_id 
  ON public.payment_transactions(monicredit_transaction_id);

-- STEP 6: Drop existing constraint if it exists (we're using enum type instead)
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS check_payment_gateway;

-- STEP 7: Update existing transactions to have payment_gateway = 'paystack' (backward compatibility)
UPDATE public.payment_transactions
  SET payment_gateway = 'paystack'
  WHERE payment_gateway IS NULL;
