-- =============================================
-- STORAGE BUCKET: car-documents
-- Creates bucket for car document uploads
-- Run this in Supabase SQL Editor
-- =============================================

-- Create storage bucket for car documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'car-documents',
  'car-documents',
  true,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- NOTE: Storage RLS policies cannot be created via SQL migration
-- without superuser privileges. Since we're using the service role
-- key for uploads in the backend, RLS policies are not strictly necessary.
-- 
-- If you need user-scoped access policies, set them up through:
-- 1. Supabase Dashboard > Storage > car-documents > Policies
-- 2. Or use the Supabase Management API
--
-- Example policies to create in dashboard:
-- - Users can upload to own folder: (string_to_array(name, '/'))[1] = auth.uid()::text
-- - Users can read own files: (string_to_array(name, '/'))[1] = auth.uid()::text
-- - Users can delete own files: (string_to_array(name, '/'))[1] = auth.uid()::text
