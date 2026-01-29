-- =============================================
-- SUPABASE CRON JOB - EXPIRY NOTIFICATIONS (EDGE FUNCTION VERSION)
-- Calls Edge Function to send vehicle expiry reminders
-- Includes error handling and logging
-- =============================================

-- Enable pg_cron extension (requires superuser or Supabase dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant permissions for cron jobs
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- =============================================
-- Create a table to log cron job execution history
-- =============================================

CREATE TABLE IF NOT EXISTS public.cron_job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL, -- 'success', 'failure', 'partial'
  response TEXT,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for querying logs
CREATE INDEX IF NOT EXISTS idx_cron_job_logs_job_name 
  ON public.cron_job_logs(job_name);

CREATE INDEX IF NOT EXISTS idx_cron_job_logs_executed_at 
  ON public.cron_job_logs(executed_at DESC);

-- =============================================
-- Create a PostgreSQL function to call the Edge Function
-- This function will be triggered by pg_cron with retry logic
-- =============================================

CREATE OR REPLACE FUNCTION public.trigger_expiry_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_function_url TEXT;
  api_response TEXT;
  http_status INTEGER;
  cron_secret TEXT;
  start_time TIMESTAMP;
  execution_time_ms INTEGER;
  job_status TEXT;
  error_msg TEXT;
BEGIN
  start_time := CURRENT_TIMESTAMP;
  job_status := 'success';
  error_msg := NULL;
  
  -- Call the Supabase Edge Function
  -- Replace YOUR_PROJECT_ID with your actual Supabase project ID
  edge_function_url := 'https://sbogxkurbwiwkaacochb.supabase.co/functions/v1/expiry-notifications';

  -- Get the secret from environment
  cron_secret := 'your-cron-secret-key'; -- REPLACE WITH YOUR ACTUAL SECRET
  
  BEGIN
    -- Make HTTP POST request to Edge Function
    -- The Edge Function now includes built-in retry logic (3 retries with exponential backoff)
    SELECT content INTO api_response
    FROM http((
      'POST',
      edge_function_url,
      ARRAY[
        http_header('Content-Type', 'application/json'),
        http_header('Authorization', 'Bearer ' || cron_secret)
      ],
      'application/json',
      '{}'
    )::http_request);
    
    RAISE NOTICE '[Cron] Expiry notification Edge Function triggered successfully';
    
  EXCEPTION WHEN OTHERS THEN
    job_status := 'failure';
    error_msg := SQLERRM;
    RAISE WARNING '[Cron] Failed to trigger expiry notification Edge Function: %', SQLERRM;
  END;
  
  -- Calculate execution time
  execution_time_ms := EXTRACT(MILLISECOND FROM (CURRENT_TIMESTAMP - start_time))::INTEGER;
  
  -- Log the job execution
  INSERT INTO public.cron_job_logs (job_name, status, response, error_message, execution_time_ms)
  VALUES (
    'expiry-notifications-daily',
    job_status,
    api_response,
    error_msg,
    execution_time_ms
  );
  
  RAISE NOTICE '[Cron] Job logged with status: %, execution time: %ms', job_status, execution_time_ms;
END;
$$;

-- =============================================
-- SCHEDULE THE CRON JOB
-- Runs daily at 08:00 UTC (09:00 WAT)
-- =============================================

-- Remove existing job if it exists (safely)
DO $$
BEGIN
  PERFORM cron.unschedule('expiry-notifications-daily');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Job does not exist yet, continuing...';
END
$$;

-- Schedule the job (runs daily at 08:00 UTC)
SELECT cron.schedule(
  'expiry-notifications-daily',           -- Job name
  '0 8 * * *',                            -- Cron schedule (daily at 08:00 UTC)
  $$SELECT public.trigger_expiry_notifications()$$
);

-- =============================================
-- VERIFY CRON JOB
-- =============================================

-- View scheduled jobs
-- SELECT * FROM cron.job;

-- View job run history
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- View cron logs created by this function
-- SELECT * FROM public.cron_job_logs ORDER BY created_at DESC LIMIT 20;

-- =============================================
-- IMPORTANT SETUP INSTRUCTIONS
-- =============================================

/*
1. Enable pg_net extension in Supabase Dashboard:
   - Go to Database > Extensions
   - Search for "pg_net"
   - Enable it

2. Create/Deploy Edge Function:
   - Edge Function is at: supabase/functions/expiry-notifications/index.ts
   - Deploy using: supabase functions deploy expiry-notifications
   - Or use Supabase Dashboard to create the function

3. Generate a secure CRON_SECRET_KEY:
   - Generate a random API key (use: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   - You'll use this in steps 4 and 5

4. Update this migration with your CRON_SECRET_KEY:
   - Find this line: cron_secret := 'your-cron-secret-key';
   - Replace 'your-cron-secret-key' with your generated secret

5. Set CRON_SECRET_KEY in Edge Function secrets:
   - Go to Supabase Dashboard > Functions > expiry-notifications > Configuration
   - Add these secrets:
     CRON_SECRET_KEY = your-generated-secret-key
     RESEND_API_KEY = your-resend-api-key
     EMAIL_FROM = Motoka <no-reply@motokaapp.ng>

6. Update migration with your Project ID:
   - Find YOUR_PROJECT_ID in Supabase Dashboard (Settings > API)
   - Replace YOUR_PROJECT_ID in the edge_function_url

7. Run this migration in Supabase SQL Editor

8. Verify the cron job is scheduled:
   SELECT * FROM cron.job WHERE jobname = 'expiry-notifications-daily';

9. Monitor cron job execution:
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'expiry-notifications-daily')
   ORDER BY start_time DESC 
   LIMIT 10;
*/

COMMENT ON FUNCTION public.trigger_expiry_notifications() IS 'Triggers expiry notification check via Supabase Edge Function. Called by pg_cron daily at 08:00 UTC.';
