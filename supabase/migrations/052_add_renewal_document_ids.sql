-- Add renewal_document_ids to subscriptions table
-- Stores the snapshot of document IDs from the original order so auto-renewal
-- renews exactly the same documents the user selected, nothing more.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS renewal_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN subscriptions.renewal_document_ids IS
  'Snapshot of payment_schedule IDs selected in the original order. Used by the auto-charge job to renew the same documents.';
