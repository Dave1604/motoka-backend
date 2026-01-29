# Cron Job Setup Guide - Vehicle Expiry Notifications

## Overview
This guide explains how to set up the PostgreSQL cron job that automatically triggers the Edge Function to send vehicle expiry reminder emails at scheduled intervals.

## Architecture
```
Cron Job (pg_cron) 
    ↓ (runs daily at 08:00 UTC)
PostgreSQL Function (trigger_expiry_notifications)
    ↓ (makes HTTP POST request)
Supabase Edge Function (expiry-notifications)
    ↓ (queries cars table & checks notification history)
Resend API
    ↓ (sends emails)
User Inbox
```

---

## Step-by-Step Setup Instructions

### Step 1: Enable Required Extensions

In your Supabase dashboard:

1. Navigate to **Database** → **Extensions**
2. Search for and enable:
   - **pg_cron** - for scheduling cron jobs
   - **pg_net** - for making HTTP requests from PostgreSQL

Alternatively, run in your SQL editor:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

**Note:** These extensions may require superuser/admin privileges. Contact Supabase support if you encounter permission errors.

---

### Step 2: Deploy the Edge Function

Before the cron job can trigger it, the Edge Function must be deployed.

#### Option A: Using Supabase CLI (Recommended)
```bash
# From project root
supabase functions deploy expiry-notifications
```

The function will be deployed to:
```
https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications
```

#### Option B: Using Supabase Dashboard
1. Go to **Edge Functions** in your Supabase dashboard
2. Click **Create a new function**
3. Name it: `expiry-notifications`
4. Copy contents from `supabase/functions/expiry-notifications/index.ts`
5. Deploy

---

### Step 3: Get Your Supabase Project ID

1. Go to Supabase Dashboard → **Settings** → **API**
2. Copy the **Project URL** (or find Project ID in Settings)
3. Your project ID is the subdomain, e.g., `sbogxkurbwiwkaacochb`

---

### Step 4: Update the Migration with Your Project ID

Edit `supabase/migrations/014_setup_cron_jobs_edge_function.sql`:

**Find this line:**
```sql
edge_function_url := 'https://sbogxkurbwiwkaacochb.supabase.co/functions/v1/expiry-notifications';
```

**Replace with:**
```sql
edge_function_url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications';
```

Example:
```sql
edge_function_url := 'https://xyz12345abcde.supabase.co/functions/v1/expiry-notifications';
```

---

### Step 5: Apply the Migrations

Run the migrations in order:

```bash
# Option 1: Using Supabase CLI
supabase db push

# Option 2: Manually in Supabase SQL Editor
-- Paste contents of 013_expiry_notifications.sql
-- Then paste contents of 014_setup_cron_jobs_edge_function.sql
```

---

### Step 6: Verify the Cron Job

After migrations are applied, verify the job is scheduled:

```sql
-- View scheduled cron jobs
SELECT * FROM cron.job;

-- View recent job executions
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

You should see `expiry-notifications-daily` in the results.

---

## Cron Job Schedule

**Runs:** Daily at **08:00 UTC** (09:00 WAT)

To change the schedule, modify this line in the migration:
```sql
'0 8 * * *',  -- Cron syntax: minute hour day month dayofweek
```

| Time | Cron Syntax |
|------|-----------|
| Daily at 8:00 AM UTC | `0 8 * * *` |
| Every 6 hours | `0 */6 * * *` |
| Every 30 minutes | `*/30 * * * *` |
| Weekdays at 8:00 AM | `0 8 * * 1-5` |

---

## What Happens When the Cron Runs

1. **Cron triggers** `public.trigger_expiry_notifications()` function
2. **PostgreSQL function** makes HTTP POST request to Edge Function
3. **Edge Function** (`index.ts`):
   - Connects to Supabase using service role key
   - Queries `cars` table for vehicles expiring in: 30, 14, 7, 3, 2, 1 days
   - Checks `expiry_notifications` table to avoid duplicate emails
   - Sends reminder emails via **Resend API** for new expiries
   - Records sent notifications in `expiry_notifications` table
4. **Users receive emails** if their vehicle is expiring

---

## Database Tables Created

### 1. `expiry_notifications` (013 migration)
Tracks which notifications have been sent to prevent duplicates.

**Columns:**
- `id` - Primary key
- `car_id` - Reference to vehicle
- `user_id` - Reference to user
- `notification_type` - Type: 30_days, 14_days, 7_days, 3_days, 2_days, 1_day
- `expiry_date` - Vehicle expiry date
- `sent_at` - When email was sent
- `email_id` - Resend email ID for tracking
- `created_at` - Record creation time

**Indexes:** Created on `car_id`, `user_id`, `sent_at`, and unique constraint on (car_id, notification_type, expiry_date)

**RLS Policies:**
- Users can view their own notifications
- Service role has full access (needed for cron jobs)

---

## Environment Variables Required

The Edge Function needs these Supabase environment variables (usually auto-set):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

These are pre-configured in Supabase Edge Functions context. No additional setup needed.

For Resend emails, the service role key must have permissions to send emails (check in your Resend dashboard).

---

## Troubleshooting

### Cron Job Not Running

1. **Check if extensions are enabled:**
   ```sql
   SELECT * FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
   ```

2. **Check for errors in job history:**
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'expiry-notifications-daily')
   ORDER BY start_time DESC LIMIT 5;
   ```

3. **Check Edge Function logs:**
   - Supabase Dashboard → Edge Functions → expiry-notifications → Details

### Emails Not Sending

1. **Verify Resend API key** is configured in Edge Function environment
2. **Check expiry_notifications table** for failed attempts
3. **View Edge Function logs** for detailed error messages
4. **Verify RLS policies** allow service role access to `expiry_notifications`

### Function Permission Errors

If you get permission errors on `cron.*` tables:
- Contact Supabase support to enable pg_cron for your database
- Or use Supabase Dashboard → SQL Editor to run the migration with elevated permissions

---

## Manual Testing

To test the cron job without waiting for scheduled time:

```sql
-- Manually trigger the function
SELECT public.trigger_expiry_notifications();

-- Check the job ran successfully
SELECT * FROM cron.job_run_details 
WHERE jobname = 'expiry-notifications-daily'
ORDER BY start_time DESC LIMIT 1;
```

To test email sending directly:
- Query the Edge Function URL manually
- Or check recent logs in Supabase Dashboard

---

## Configuration Options

### Change Notification Intervals

Edit `supabase/functions/expiry-notifications/index.ts`:

```typescript
const NOTIFICATION_INTERVALS = [
  { days: 30, type: '30_days' },
  { days: 14, type: '14_days' },
  { days: 7, type: '7_days' },
  { days: 3, type: '3_days' },
  { days: 2, type: '2_days' },
  { days: 1, type: '1_day' }
];
```

Redeploy: `supabase functions deploy expiry-notifications`

### Change Email From Address

In Edge Function (`index.ts`), the `emailFrom` should match a verified sender in your Resend account:
```typescript
const emailFrom = 'noreply@motokapp.ng'; // Update this
```

### Clean Up Old Notifications

The migration creates a cleanup function:

```sql
-- Manually run
SELECT public.cleanup_old_expiry_notifications();

-- Or schedule it to run monthly
SELECT cron.schedule(
  'cleanup-old-notifications-monthly',
  '0 2 1 * *', -- Monthly at 2:00 AM UTC on 1st day
  $$SELECT public.cleanup_old_expiry_notifications()$$
);
```

---

## Summary of Files

| File | Purpose |
|------|---------|
| `supabase/migrations/013_expiry_notifications.sql` | Creates `expiry_notifications` table and RLS policies |
| `supabase/migrations/014_setup_cron_jobs_edge_function.sql` | Sets up pg_cron job + PostgreSQL function to trigger Edge Function |
| `supabase/functions/expiry-notifications/index.ts` | Edge Function that queries database and sends emails |

---

## Next Steps

1. ✅ Enable extensions (pg_cron, pg_net)
2. ✅ Deploy Edge Function (`supabase functions deploy`)
3. ✅ Update migration with your Project ID
4. ✅ Apply migrations (`supabase db push`)
5. ✅ Verify job is scheduled (`SELECT * FROM cron.job`)
6. ✅ Test manually (`SELECT public.trigger_expiry_notifications()`)
7. ✅ Monitor logs and email delivery

---

**Last Updated:** January 29, 2026  
**Status:** Ready for Production Deployment
