/**
 * Migration: Add delivery details and item breakdown to renewal orders
 * 
 * This migration adds columns to store:
 * - Selected renewal items (vehicle licence, insurance, etc.)
 * - Amount breakdown (renewal items vs delivery fee)
 * - Delivery information (address, state, LGA, contact)
 */

-- Add columns for renewal items and amount breakdown
ALTER TABLE renewal_orders
ADD COLUMN selected_items JSONB DEFAULT '[]'::jsonb,
ADD COLUMN renewal_amount BIGINT,
ADD COLUMN delivery_fee BIGINT DEFAULT 0;

-- Add columns for delivery information
ALTER TABLE renewal_orders
ADD COLUMN delivery_address TEXT,
ADD COLUMN delivery_state VARCHAR(2),
ADD COLUMN delivery_lga VARCHAR(100),
ADD COLUMN delivery_contact VARCHAR(20);

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
