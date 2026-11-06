-- ============================================================
-- MIGRATION 113 – profiles.has_car (admin Users "cars" filter)
-- ============================================================
-- The admin Users page gained a filter: users with cars vs users with zero
-- cars (leads who signed up but never registered a vehicle). Filtering in
-- SQL needs an anti-join against cars, which PostgREST/Supabase JS cannot
-- express, so we keep a denormalised has_car flag on profiles, maintained by
-- a trigger on cars.
--
-- Soft deletes matter: only cars with deleted_at IS NULL count.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_car BOOLEAN NOT NULL DEFAULT FALSE;

-- Recompute one owner's flag from the cars table.
CREATE OR REPLACE FUNCTION public.recompute_profile_has_car(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
     SET has_car = EXISTS (
       SELECT 1 FROM public.cars c
       WHERE c.user_id = p_user_id AND c.deleted_at IS NULL
     )
   WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire on every cars write: insert, soft delete, restore, and user_id moves.
CREATE OR REPLACE FUNCTION public.trg_cars_recompute_has_car()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_profile_has_car(OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_profile_has_car(NEW.user_id);
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.recompute_profile_has_car(OLD.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS cars_recompute_has_car ON public.cars;
CREATE TRIGGER cars_recompute_has_car
  AFTER INSERT OR UPDATE OR DELETE ON public.cars
  FOR EACH ROW EXECUTE FUNCTION public.trg_cars_recompute_has_car();

-- Backfill every existing profile in one statement (fine at current scale;
-- re-run-safe because it is idempotent).
UPDATE public.profiles p
   SET has_car = EXISTS (
     SELECT 1 FROM public.cars c
     WHERE c.user_id = p.id AND c.deleted_at IS NULL
   );
