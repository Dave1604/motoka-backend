-- =============================================
-- Migration 039: Driver's License Applications
-- Stores form data for new/renew applications per Figma
-- =============================================

CREATE TABLE IF NOT EXISTS public.driver_license_applications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_type VARCHAR(20) NOT NULL DEFAULT 'new',  -- 'new' | 'renew'
  -- Passport / document
  passport_photo_url TEXT,
  license_document_url TEXT,  -- uploaded license (for renew/expired re-upload)
  -- Personal details (Figma form)
  full_name VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  date_of_birth DATE,
  place_of_birth VARCHAR(255),
  home_of_origin VARCHAR(255),
  local_government VARCHAR(255),
  blood_group VARCHAR(10),
  height VARCHAR(20),
  occupation VARCHAR(255),
  next_of_kin_name VARCHAR(255),
  next_of_kin_phone VARCHAR(50),
  mother_maiden_name VARCHAR(255),
  license_years VARCHAR(50),
  -- For renew: existing license details
  license_number VARCHAR(100),
  date_of_expiry DATE,
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft | submitted | expired | approved
  order_id BIGINT REFERENCES public.renewal_orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_application_type UNIQUE (user_id, application_type)
);

CREATE INDEX idx_driver_license_applications_user ON public.driver_license_applications(user_id);
CREATE INDEX idx_driver_license_applications_status ON public.driver_license_applications(status);
CREATE INDEX idx_driver_license_applications_created ON public.driver_license_applications(created_at DESC);

ALTER TABLE public.driver_license_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own applications"
  ON public.driver_license_applications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applications"
  ON public.driver_license_applications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own applications"
  ON public.driver_license_applications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON public.driver_license_applications FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);
