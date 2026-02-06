-- Cron Job Setup for Expiry Notifications
-- Triggers the Edge Function daily at 8:00 AM UTC

CREATE OR REPLACE FUNCTION public.trigger_expiry_notifications()
RETURNS void AS $$
DECLARE
  edge_function_url TEXT;
  request_id BIGINT;
  service_role_key TEXT;
BEGIN
  -- TODO: Update with your project URL (Dashboard → Settings → API → Project URL)
  edge_function_url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/expiry-notifications';
  
  -- TODO: Update with your service role key (Dashboard → Settings → API → service_role key)
  -- WARNING: Never commit actual keys to version control!
  service_role_key := 'YOUR_SERVICE_ROLE_KEY_HERE';

  -- Make HTTP POST request to Edge Function
  SELECT net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RAISE NOTICE 'Cron triggered. Request ID: %', request_id;
EXCEPTION 
  WHEN OTHERS THEN
    RAISE WARNING 'Cron trigger failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cron job at 8:00 AM UTC daily (requires pg_cron extension)
-- If pg_cron not available, use Supabase Dashboard Cron Triggers instead
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expiry-notifications-daily');
    PERFORM cron.schedule(
      'expiry-notifications-daily',
      '0 8 * * *',
      'SELECT public.trigger_expiry_notifications();'
    );
    RAISE NOTICE 'Cron job scheduled successfully';
  ELSE
    RAISE NOTICE 'pg_cron not available - use Dashboard Cron Triggers (see DEPLOYMENT.md)';
  END IF;
EXCEPTION 
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron job - use Dashboard Cron Triggers (see DEPLOYMENT.md)';
END $$;
