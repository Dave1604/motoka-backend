-- Allow vehicle_year to be null (admin may not always have this info)
ALTER TABLE cars ALTER COLUMN vehicle_year DROP NOT NULL;
