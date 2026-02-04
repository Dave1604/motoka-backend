# Quick Start Commands

## Initial Setup
```bash
# 1. Login and link project
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_ID

# 2. Set environment variables
npx supabase secrets set RESEND_API_KEY=your_key_here
npx supabase secrets set EMAIL_FROM="Your App <noreply@yourdomain.com>"

# 3. Update migration file (line 11 and 14 in 014_setup_expiry_notifications_cron.sql)
# - Add your project URL
# - Add your service_role key

# 4. Deploy
npx supabase db push
npx supabase functions deploy expiry-notifications
```

## Test Edge Function
```bash
# PowerShell
$headers = @{
    "Authorization" = "Bearer YOUR_SERVICE_ROLE_KEY"
    "Content-Type" = "application/json"
}
Invoke-RestMethod -Uri "https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications" -Method POST -Headers $headers -Body "{}"

# Bash
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Monitor
```sql
-- Recent notifications
SELECT * FROM public.expiry_notification_history ORDER BY email_sent_at DESC LIMIT 10;

-- Recent errors
SELECT * FROM public.expiry_notification_errors ORDER BY created_at DESC LIMIT 10;

-- Check cron job (if using pg_cron)
SELECT * FROM cron.job WHERE jobname = 'expiry-notifications-daily';
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete documentation.
