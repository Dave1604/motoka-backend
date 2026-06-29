-- Migration 064: payment_transactions.cancellation_reason
--
-- Why this column:
--   When a payment transaction ends up `abandoned` or `failed`, we currently
--   have no way to distinguish *why* in SQL. The admin Payments page is
--   dominated by abandoned rows from users clicking "Pay" multiple times or
--   switching gateways mid-init — these are NOT genuine drop-offs or gateway
--   failures, just UX-driven noise.
--
-- Values written by the application layer:
--   - 'duplicate_init'    — prior pending was abandoned because the user
--                           re-initialised payment (gateway switch or retry).
--   - 'gateway_failure'   — Monicredit or Paystack rejected the init, or the
--                           gateway returned a failed verify status.
--   - 'user_abandoned'    — the user explicitly cancelled or navigated away.
--   - 'manual_cleanup'    — admin-driven cleanup, set in a one-off script.
--
-- The column is NULL-able and additive. Existing rows stay NULL until a
-- separate backfill script tags them.

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Loose validation. A CHECK constraint with a closed set would be cleaner
-- but locks us in; an open text column lets new reasons land without a
-- migration. Index supports the admin filter that hides duplicate_init rows
-- from the default Payments view.
CREATE INDEX IF NOT EXISTS idx_payment_transactions_cancellation_reason
  ON payment_transactions (cancellation_reason)
  WHERE cancellation_reason IS NOT NULL;

COMMENT ON COLUMN payment_transactions.cancellation_reason IS
  'Why a non-successful txn ended up in its terminal state. See migration 064.';
