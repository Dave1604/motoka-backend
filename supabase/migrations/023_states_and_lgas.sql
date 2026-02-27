/**
 * Migration: Create states and local governments tables
 * 
 * This migration creates tables to store Nigerian states and LGAs
 * with delivery fees, replacing the constants file approach.
 * 
 * Benefits:
 * - Dynamic delivery fee updates without code deployment
 * - Admin panel support for managing states/LGAs
 * - Better scalability and maintainability
 * - Audit trail of changes
 */

-- Create states table
CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  code VARCHAR(2) NOT NULL UNIQUE,
  delivery_fee BIGINT NOT NULL DEFAULT 500000, -- in kobo (₦5,000 default)
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create local governments table
CREATE TABLE IF NOT EXISTS local_governments (
  id SERIAL PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(state_id, name)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lgas_state_id ON local_governments(state_id);
CREATE INDEX IF NOT EXISTS idx_states_code ON states(code);
CREATE INDEX IF NOT EXISTS idx_states_active ON states(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_lgas_active ON local_governments(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_states_display_order ON states(display_order) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_lgas_display_order ON local_governments(display_order) WHERE is_active = TRUE;

-- Add comments for documentation
COMMENT ON TABLE states IS 'Nigerian states with delivery fees';
COMMENT ON TABLE local_governments IS 'Local government areas (LGAs) for each state';
COMMENT ON COLUMN states.delivery_fee IS 'Delivery fee in kobo (e.g., 300000 = ₦3,000)';
COMMENT ON COLUMN states.code IS 'Two-letter state code (e.g., LA for Lagos)';
COMMENT ON COLUMN states.is_active IS 'Whether the state is currently active/available';
COMMENT ON COLUMN local_governments.is_active IS 'Whether the LGA is currently active/available';

-- Enable Row Level Security (RLS)
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_governments ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow public read access for active states/LGAs
CREATE POLICY "Anyone can view active states"
  ON states FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Anyone can view active local governments"
  ON local_governments FOR SELECT
  USING (is_active = TRUE);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-update updated_at
CREATE TRIGGER update_states_updated_at
  BEFORE UPDATE ON states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_local_governments_updated_at
  BEFORE UPDATE ON local_governments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
