-- Renewal window sweeper trigger — fires even when Render sleeps or the
-- paid plan lapses, so scheduled holds always release on time.
-- Migration 102.
--
-- HOW TO APPLY (Dave, Supabase SQL editor):
--   1. Replace __SWEEP_SECRET__ below with a long random string, run the file.
--   2. Set the SAME value as INTERNAL_CRON_SECRET in Render → Environment.
-- The committed file must keep the placeholder — never commit the real secret.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule first so re-running this file never stacks duplicate jobs.
DO $$
BEGIN
  PERFORM cron.unschedule('renewal-sweep-hourly');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'renewal-sweep-hourly does not exist yet, continuing...';
END
$$;

SELECT cron.schedule(
  'renewal-sweep-hourly',
  '17 * * * *',
  $$SELECT net.http_post(
    url := 'https://motoka-backend.onrender.com/api/internal/sweeper/release',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__SWEEP_SECRET__'
    ),
    body := '{}'::jsonb
  )$$
);
