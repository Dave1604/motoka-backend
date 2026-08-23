-- Renewals dashboard: aggregate in Postgres, not in Node.
--
-- Dashboard tiles only need a handful of numbers. Counting on the database
-- (index-only) stays cheap as the cars table grows. The RPC is SECURITY DEFINER
-- but only granted to service_role — the admin API uses the service key.

CREATE INDEX IF NOT EXISTS idx_cars_expiry_active
  ON public.cars (expiry_date)
  WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_renewals_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT CURRENT_DATE AS today
  ),
  buckets AS (
    SELECT
      COUNT(*) FILTER (WHERE c.expiry_date < b.today) AS expired,
      COUNT(*) FILTER (WHERE c.expiry_date = b.today) AS today,
      COUNT(*) FILTER (WHERE c.expiry_date BETWEEN b.today + 1 AND b.today + 7) AS week,
      COUNT(*) FILTER (WHERE c.expiry_date BETWEEN b.today + 8 AND b.today + 30) AS month,
      COUNT(*) FILTER (WHERE c.expiry_date BETWEEN b.today + 31 AND b.today + 90) AS quarter
    FROM public.cars c
    CROSS JOIN bounds b
    WHERE c.deleted_at IS NULL
      AND c.expiry_date IS NOT NULL
  ),
  months AS (
    SELECT
      to_char(date_trunc('month', c.expiry_date), 'YYYY-MM') AS month,
      COUNT(*)::int AS count
    FROM public.cars c
    CROSS JOIN bounds b
    WHERE c.deleted_at IS NULL
      AND c.expiry_date IS NOT NULL
      AND c.expiry_date < b.today
      AND c.expiry_date >= (date_trunc('month', b.today) - interval '11 months')::date
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'buckets', (
      SELECT jsonb_build_object(
        'expired', expired,
        'today', today,
        'week', week,
        'month', month,
        'quarter', quarter
      ) FROM buckets
    ),
    'expired_this_month', (
      SELECT COUNT(*)::int
      FROM public.cars c
      CROSS JOIN bounds b
      WHERE c.deleted_at IS NULL
        AND c.expiry_date IS NOT NULL
        AND c.expiry_date >= date_trunc('month', b.today)::date
        AND c.expiry_date < b.today
    ),
    'expired_total', (SELECT expired FROM buckets),
    'by_month', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', month, 'count', count) ORDER BY month DESC)
      FROM months
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_renewals_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_renewals_summary() TO service_role;
