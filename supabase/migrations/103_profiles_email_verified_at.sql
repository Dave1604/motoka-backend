-- Enforce email verification in the app layer. Supabase auth has
-- mailer_autoconfirm on, so auth.users.email_confirmed_at is set for every
-- signup before any code is sent and proves nothing. profiles.email_verified_at
-- is set only when the user proves ownership: OTP code at signup, OTP login,
-- Google sign-in, or a guest receipt token (which arrived by email).
-- Existing accounts are grandfathered so nobody is locked out by the change.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

UPDATE public.profiles
   SET email_verified_at = COALESCE(created_at, NOW())
 WHERE email_verified_at IS NULL;
