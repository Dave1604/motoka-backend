# Database Migrations

## Recent Changes

### Migration 026: Monicredit Support
- Added `payment_gateway` enum type (`paystack`, `monicredit`)
- Added `payment_gateway` column to `payment_transactions` (defaults to `paystack`)
- Renamed `moniecredit_*` columns to `monicredit_*` for consistency
- Added indexes for gateway and Monicredit-specific fields

### Migration 027: Optional Renewal Items
- Made all renewal items optional (not required)
- Users can now select any combination of renewal items

### Migration 028: Schema Fixes
- Added missing `webhook_event_id` and `webhook_processed_at` columns
- Ensured `subscriptions` table exists with proper indexes and RLS policies
- Ensured `local_governments` table exists with proper structure
