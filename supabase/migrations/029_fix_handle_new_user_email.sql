-- =============================================
-- FIX: Make handle_new_user trigger resilient.
-- Migration 012 added email NOT NULL to profiles
-- but the trigger never included email in INSERT.
-- Also wraps the insert in an exception handler
-- so a trigger failure can never block auth.signUp().
-- The backend register controller now handles
-- profile creation explicitly as the primary path.
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_user_id VARCHAR(6);
  first_name_val VARCHAR(255);
  last_name_val VARCHAR(255);
BEGIN
  -- Generate unique user_id
  LOOP
    new_user_id := public.generate_user_id();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = new_user_id);
  END LOOP;

  first_name_val := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  last_name_val := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), ''),
    ''
  );

  BEGIN
    INSERT INTO public.profiles (
      id, user_id, first_name, last_name, phone_number, email, user_type_id
    ) VALUES (
      NEW.id,
      new_user_id,
      first_name_val,
      last_name_val,
      NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
      NEW.email,
      2
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Never block user creation due to a profile insert failure.
    -- The backend will create/repair the profile after signUp succeeds.
    RAISE WARNING 'handle_new_user: could not create profile for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
