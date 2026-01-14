-- =============================================
-- TRIGGER: Auto-create profile on user signup
-- This runs when a new user signs up via Supabase Auth
-- Run this in Supabase SQL Editor
-- =============================================

-- Function to generate 6-character user ID
CREATE OR REPLACE FUNCTION public.generate_user_id()
RETURNS VARCHAR(6) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result VARCHAR(6) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to handle new user signup
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
  
  -- Extract names from metadata or email
  first_name_val := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    split_part(NEW.email, '@', 1)
  );
  last_name_val := COALESCE(
    NEW.raw_user_meta_data->>'last_name',
    ''
  );
  
  -- Create profile
  INSERT INTO public.profiles (
    id,
    user_id,
    first_name,
    last_name,
    phone_number,
    user_type_id
  ) VALUES (
    NEW.id,
    new_user_id,
    first_name_val,
    last_name_val,
    NEW.raw_user_meta_data->>'phone',
    2  -- Default to 'Client'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger for new user signups
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

