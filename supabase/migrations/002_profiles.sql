-- =============================================
-- PROFILES TABLE (Extended user data)
-- Links to Supabase auth.users via id
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS public.profiles (
  -- Primary key links to auth.users
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Custom 6-character user ID (for legacy compatibility)
  user_id VARCHAR(6) UNIQUE NOT NULL,
  
  -- User type
  user_type_id BIGINT DEFAULT 2 REFERENCES public.user_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  
  -- Profile info
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(255) UNIQUE,
  image VARCHAR(255),
  
  -- Identity
  nin VARCHAR(255), -- National ID Number
  address TEXT,
  gender VARCHAR(10) CHECK (gender IN ('male', 'female', 'other')),
  
  -- Two-Factor Authentication
  two_factor_secret TEXT,
  two_factor_recovery_codes JSONB,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_type VARCHAR(10) CHECK (two_factor_type IN ('email', 'google')),
  two_factor_email_code VARCHAR(255),
  two_factor_email_expires_at TIMESTAMPTZ,
  two_factor_login_token VARCHAR(100),
  two_factor_login_expires_at TIMESTAMPTZ,
  two_factor_confirmed_at TIMESTAMPTZ,
  
  -- Admin & Status
  is_admin BOOLEAN DEFAULT FALSE,
  user_type VARCHAR(255) DEFAULT 'user',
  is_suspended BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ -- Soft delete
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON public.profiles(deleted_at);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile
CREATE POLICY "Users can view own profile" 
  ON public.profiles 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" 
  ON public.profiles 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can do anything (for backend operations)
CREATE POLICY "Service role has full access" 
  ON public.profiles 
  FOR ALL 
  TO service_role 
  USING (true)
  WITH CHECK (true);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS on_profiles_updated ON public.profiles;
CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

