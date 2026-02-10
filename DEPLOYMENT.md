# Vehicle Expiry Notification System - Deployment Guide

Production-ready automated email notification system for vehicle document expiry reminders.

## Overview

**Sends automated emails at:** 30d, 14d, 7d, 3d, 2d, 1d before expiry, on expiry day, and 3d, 7d after expiry.

**Architecture:**
```
Supabase Cron/Scheduler → Edge Function → Resend API → User Email
                        ↓
                  PostgreSQL (tracking)
```

---

## Prerequisites

- Supabase project (any tier)
- Resend API account with verified domain
- Supabase CLI installed: `npm i supabase -g`

---

## Step 1: Configure Supabase CLI

```bash
# Login to Supabase
npx supabase login

# Link to your project
npx supabase link --project-ref YOUR_PROJECT_ID
```

---

## Step 2: Update Configuration

### A. Update Edge Function URL

Edit `supabase/migrations/014_setup_expiry_notifications_cron.sql`:

```sql
-- Line 10: Replace with your project URL
edge_function_url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications';

-- Line 13: Replace with your service role key (from Dashboard → Settings → API)
service_role_key := 'YOUR_SERVICE_ROLE_KEY_HERE';
```

### B. Set Environment Variables

```bash
# Set Resend API key
npx supabase secrets set RESEND_API_KEY=re_your_api_key_here

# Set sender email (must be verified in Resend)
npx supabase secrets set EMAIL_FROM="Your App <noreply@yourdomain.com>"
```

---

## Step 3: Deploy

### A. Push Database Migrations

```bash
npx supabase db push
```

This creates:
- `expiry_notification_history` table (tracks sent emails)
- `expiry_notification_errors` table (error logging)
- `trigger_expiry_notifications()` function
- Cron job (if pg_cron available)

### B. Deploy Edge Function

```bash
npx supabase functions deploy expiry-notifications
```

---

## Step 4: Set Up Automation

### Option A: Using pg_cron (Pro Plan+)

Already configured if migration succeeded. Verify:

```sql
-- Check if scheduled
SELECT * FROM cron.job WHERE jobname = 'expiry-notifications-daily';

-- Manual test
SELECT public.trigger_expiry_notifications();
```

### Option B: Using Dashboard Cron (All Plans)

If `pg_cron` is not available:

1. Go to **Dashboard → Edge Functions → expiry-notifications**
2. Click **Cron Triggers** tab
3. Add trigger:
   - **Schedule:** `0 8 * * *` (8:00 AM UTC daily)
   - **HTTP Method:** POST
   - **Region:** Closest to your users
   - **Headers:** 
     ```
     Authorization: Bearer YOUR_SERVICE_ROLE_KEY
     Content-Type: application/json
     ```
   - **Body:** `{}`

---

## Step 5: Test

### Test Edge Function Directly

```bash
# PowerShell
$headers = @{
    "Authorization" = "Bearer YOUR_SERVICE_ROLE_KEY"
    "Content-Type" = "application/json"
}
Invoke-RestMethod -Uri "https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications" -Method POST -Headers $headers -Body "{}"

# Bash/Linux/Mac
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:
```json
{
  "success": true,
  "totalCars": 5,
  "emailsSent": 5,
  "emailsFailed": 0,
  "alreadySent": 0,
  "errors": [],
  "executionTimeMs": 3200
}
```

### Check Notification History

```sql
-- View sent notifications
SELECT * FROM public.expiry_notification_history 
ORDER BY email_sent_at DESC 
LIMIT 10;

-- Check for errors
SELECT * FROM public.expiry_notification_errors 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## Monitoring

### Check Execution Logs

**Dashboard → Edge Functions → expiry-notifications → Logs**

### Query Metrics

```sql
-- Total notifications sent today
SELECT COUNT(*) 
FROM public.expiry_notification_history 
WHERE DATE(email_sent_at) = CURRENT_DATE;

-- Success rate
SELECT 
  notification_type,
  COUNT(*) as total_sent,
  COUNT(DISTINCT car_id) as unique_cars
FROM public.expiry_notification_history
WHERE email_sent_at > NOW() - INTERVAL '7 days'
GROUP BY notification_type
ORDER BY total_sent DESC;

-- Recent errors
SELECT 
  error_code,
  COUNT(*) as occurrences,
  MAX(created_at) as last_seen
FROM public.expiry_notification_errors
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY error_code;
```

---

## Troubleshooting

### Function Returns 401 Unauthorized

- Verify `service_role_key` in migration matches Dashboard → Settings → API
- Ensure Authorization header includes `Bearer ` prefix
- Check environment variables are set: `npx supabase secrets list`

### No Emails Sent

1. Check Resend API key is valid
2. Verify sender email is verified in Resend dashboard
3. Check Edge Function logs for errors
4. Ensure `EMAIL_FROM` environment variable is set

### Cron Not Running

**If using pg_cron:**
```sql
-- Check extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- View recent runs
SELECT * FROM cron.job_run_details 
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'expiry-notifications-daily')
ORDER BY start_time DESC LIMIT 5;
```

**If pg_cron not available:** Use Dashboard Cron Triggers (see Step 4, Option B)

### Duplicate Emails

The system prevents duplicates via database constraint. If duplicates occur:
```sql
-- Check constraint exists
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'expiry_notification_history' 
  AND constraint_type = 'UNIQUE';
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | Yes | Your Resend API key |
| `EMAIL_FROM` | Yes | Verified sender email |
| `SUPABASE_URL` | Auto | Injected by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Injected by Supabase |

### Notification Schedule

Edit `supabase/functions/expiry-notifications/config.ts`:

```typescript
NOTIFICATION_INTERVALS: [
  { days: -30, type: 'reminder_30d', name: '1 Month Before' },
  { days: -14, type: 'reminder_14d', name: '2 Weeks Before' },
  { days: -7, type: 'reminder_7d', name: '1 Week Before' },
  { days: -3, type: 'reminder_3d', name: '3 Days Before' },
  { days: -2, type: 'reminder_2d', name: '2 Days Before' },
  { days: -1, type: 'reminder_1d', name: '1 Day Before' },
  { days: 0, type: 'expiry_day', name: 'Expiry Day' },
  { days: 3, type: 'overdue_3d', name: '3 Days Overdue' },
  { days: 7, type: 'overdue_7d', name: '1 Week Overdue' },
]
```

Redeploy after changes: `npx supabase functions deploy expiry-notifications`

---

## Security Notes

- Never commit `service_role_key` to git
- Store sensitive keys in environment variables
- Use Supabase Vault for production: [Supabase Vault Docs](https://supabase.com/docs/guides/database/vault)
- Rotate keys periodically

---

## Performance

- **Batch processing:** 50 emails per batch
- **Rate limiting:** 1s delay between batches
- **Retry logic:** 3 attempts with exponential backoff
- **Timeout:** 9 minutes max execution time
- **Scales to:** 10,000+ cars per run

---

## Support

For issues:
1. Check Edge Function logs in Dashboard
2. Query `expiry_notification_errors` table
3. Verify Resend dashboard for delivery status
4. Review [Supabase Edge Functions docs](https://supabase.com/docs/guides/functions)

---

**Last Updated:** February 4, 2026  
**Status:** Production Ready ✅
