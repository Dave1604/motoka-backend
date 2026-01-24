-- Remove date_issued requirement from registered cars constraint
-- Only expiry_date is now required for registered cars

-- Drop the old constraint
ALTER TABLE cars DROP CONSTRAINT IF EXISTS valid_registered_car_dates;

-- Add new constraint that only requires expiry_date for registered cars
ALTER TABLE cars ADD CONSTRAINT valid_registered_car_dates CHECK (
    registration_status = 'unregistered' 
    OR (expiry_date IS NOT NULL)
);
