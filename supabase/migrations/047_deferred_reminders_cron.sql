-- Cron trigger for deferred document reminders edge function
-- Runs daily and handles both:
-- 1) expiry-based reminders
-- 2) skipped-document nudges (24h/48h/72h)

DO $$
BEGIN
  PERFORM cron.unschedule('deferred-doc-reminders-daily');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Job does not exist yet, continuing...';
END
$$;

SELECT cron.schedule(
  'deferred-doc-reminders-daily',
  '0 8 * * *',
  $$SELECT net.http_post(
    url := 'https://sbogxkurbwiwkaacochb.supabase.co/functions/v1/deferred-doc-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer 8c23a4acdd9a0af56868fac37a94f71157fb3ed4908d0863f52a63fc11cd9ac2'
    ),
    body := '{}'::jsonb
  )$$
);
