-- =============================================
-- ADD EMAIL TO PROFILES FOR SCALABILITY
-- Eliminates need to query auth.users for email lookups
-- =============================================

-- Add email column (nullable initially to allow backfill)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Backfill email from auth.users for existing records
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id AND p.email IS NULL;

-- Make email NOT NULL after backfill
ALTER TABLE public.profiles 
ALTER COLUMN email SET NOT NULL;

-- Add unique constraint
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_email_unique UNIQUE (email);

-- Add index for fast email lookups (critical for password reset)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- =============================================
-- TRIGGER: Sync email from auth.users on insert
-- =============================================
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Get email from auth.users when profile is created
  SELECT email INTO NEW.email
  FROM auth.users
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-populate email on profile creation
DROP TRIGGER IF EXISTS on_profile_insert_sync_email ON public.profiles;
CREATE TRIGGER on_profile_insert_sync_email
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  WHEN (NEW.email IS NULL)
  EXECUTE FUNCTION public.sync_profile_email();

-- Note: Email updates in auth.users should be rare, but if needed,
-- application code should update profiles.email when auth.users.email changes
