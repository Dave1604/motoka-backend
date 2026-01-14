-- =============================================
-- KYCS TABLE (Know Your Customer)
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS public.kycs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nin VARCHAR(255) UNIQUE,  -- National ID Number
  bvn VARCHAR(255) UNIQUE,  -- Bank Verification Number
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kycs_user_id ON public.kycs(user_id);
CREATE INDEX IF NOT EXISTS idx_kycs_status ON public.kycs(status);

-- Enable RLS
ALTER TABLE public.kycs ENABLE ROW LEVEL SECURITY;

-- Users can view their own KYC
CREATE POLICY "Users can view own KYC" 
  ON public.kycs 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = user_id);

-- Users can insert their own KYC
CREATE POLICY "Users can insert own KYC" 
  ON public.kycs 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access" 
  ON public.kycs 
  FOR ALL 
  TO service_role 
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS on_kycs_updated ON public.kycs;
CREATE TRIGGER on_kycs_updated
  BEFORE UPDATE ON public.kycs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

