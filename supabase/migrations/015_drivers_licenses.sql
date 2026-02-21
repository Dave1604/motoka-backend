-- =============================================
-- DRIVERS LICENSES TABLE
-- For creating, renewing, lost/damaged licenses
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS public.drivers_licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug UUID UNIQUE DEFAULT gen_random_uuid(),
    
    -- Link to app's profile table user_id
    user_id VARCHAR(6) NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    
    license_number VARCHAR(50) UNIQUE,
    license_type VARCHAR(20) NOT NULL, -- new, renew, lost_damaged
    full_name VARCHAR(255),
    phone_number VARCHAR(50),
    address TEXT,
    date_of_birth DATE,
    place_of_birth VARCHAR(255),
    state_of_origin VARCHAR(255),
    local_government VARCHAR(255),
    blood_group VARCHAR(10),
    height VARCHAR(10),
    occupation VARCHAR(100),
    next_of_kin VARCHAR(255),
    next_of_kin_phone VARCHAR(50),
    mother_maiden_name VARCHAR(255),
    license_year INT,
    passport_photo TEXT,
    expired_license_upload TEXT,
    status VARCHAR(20) DEFAULT 'unpaid', -- unpaid, active, pending, rejected
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast queries by user
CREATE INDEX IF NOT EXISTS idx_drivers_licenses_user ON public.drivers_licenses(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.drivers_licenses ENABLE ROW LEVEL SECURITY;

-- Only service_role can access by default
CREATE POLICY "Service role only"
    ON public.drivers_licenses
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
