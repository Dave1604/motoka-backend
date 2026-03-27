# Partial Renewal Reminder - Quick Deploy

1. Run SQL migrations in Supabase SQL editor:
   - `supabase/migrations/046_deferred_document_reminders.sql`
   - `supabase/migrations/047_deferred_reminders_cron.sql`

2. Deploy edge function:
   - `npx supabase functions deploy deferred-doc-notifications --no-verify-jwt`

3. Set function secrets in Supabase (Functions -> deferred-doc-notifications -> Secrets):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `FRONTEND_URL`
   - `CRON_SECRET_KEY` (must match the bearer token used in migration 047)

4. Verify scheduler:
   - `select * from cron.job where jobname = 'deferred-doc-reminders-daily';`
