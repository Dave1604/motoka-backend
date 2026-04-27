-- ============================================================
-- KAGE-003: Revoke SELECT on 2FA secret columns from authenticated users
-- These columns should only be readable server-side (service role).
-- ============================================================
REVOKE SELECT (
  two_factor_secret,
  two_factor_email_code,
  two_factor_login_token,
  two_factor_recovery_codes
) ON public.profiles FROM authenticated;

-- ============================================================
-- KAGE-001: Revoke UPDATE on privilege-escalation-risk columns
-- Prevents authenticated users from writing is_admin, is_suspended,
-- user_type_id, or any 2FA secret/token columns via the REST API.
-- ============================================================
REVOKE UPDATE (
  is_admin,
  user_type_id,
  is_suspended,
  two_factor_secret,
  two_factor_email_code,
  two_factor_email_expires_at,
  two_factor_login_token,
  two_factor_login_expires_at,
  two_factor_recovery_codes,
  two_factor_confirmed_at
) ON public.profiles FROM authenticated;
