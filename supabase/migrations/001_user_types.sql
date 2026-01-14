-- =============================================
-- USER TYPES TABLE
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS public.user_types (
  id BIGSERIAL PRIMARY KEY,
  user_type_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_types ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
CREATE POLICY "User types are viewable by authenticated users" 
  ON public.user_types 
  FOR SELECT 
  TO authenticated 
  USING (true);

-- Seed default user types
INSERT INTO public.user_types (id, user_type_name) VALUES
  (1, 'Super_admin'),
  (2, 'Client')
ON CONFLICT (id) DO NOTHING;

