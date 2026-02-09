-- Fix missing columns in renewal_orders table
-- This is a safe version that won't error if columns already exist

-- Add columns for renewal items and amount breakdown
ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS selected_items JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS renewal_amount BIGINT,
ADD COLUMN IF NOT EXISTS delivery_fee BIGINT DEFAULT 0;

-- Add columns for delivery information
ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS delivery_address TEXT,
ADD COLUMN IF NOT EXISTS delivery_state VARCHAR(2),
ADD COLUMN IF NOT EXISTS delivery_lga VARCHAR(100),
ADD COLUMN IF NOT EXISTS delivery_contact VARCHAR(20);

-- Add comments for documentation
COMMENT ON COLUMN renewal_orders.selected_items IS 'Array of selected renewal items (e.g., ["vehicle_licence", "insurance"])';
COMMENT ON COLUMN renewal_orders.renewal_amount IS 'Amount for renewal items only in kobo (before delivery fee)';
COMMENT ON COLUMN renewal_orders.delivery_fee IS 'Delivery fee in kobo based on state';
COMMENT ON COLUMN renewal_orders.delivery_address IS 'Full delivery address';
COMMENT ON COLUMN renewal_orders.delivery_state IS 'Two-letter state code (e.g., "LA" for Lagos)';
COMMENT ON COLUMN renewal_orders.delivery_lga IS 'Local government area name';
COMMENT ON COLUMN renewal_orders.delivery_contact IS 'Delivery contact phone number';

-- Update existing orders to set renewal_amount = amount_paid where null
UPDATE renewal_orders 
SET renewal_amount = amount_paid 
WHERE renewal_amount IS NULL;
