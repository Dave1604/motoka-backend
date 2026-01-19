CREATE TYPE car_type AS ENUM ('private', 'commercial');
CREATE TYPE registration_status AS ENUM ('registered', 'unregistered');
CREATE TYPE car_status AS ENUM ('unpaid', 'pending', 'approved', 'rejected');
CREATE TYPE plate_type AS ENUM ('Normal', 'Customized', 'Dealership');

CREATE TABLE cars (
    id BIGSERIAL PRIMARY KEY,
    slug UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name_of_owner VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    address TEXT NOT NULL,
    vehicle_make VARCHAR(50) NOT NULL,
    vehicle_model VARCHAR(50) NOT NULL,
    vehicle_year INTEGER NOT NULL CHECK (vehicle_year >= 1900 AND vehicle_year <= 2100),
    vehicle_color VARCHAR(30) NOT NULL,
    car_type car_type NOT NULL,
    registration_status registration_status NOT NULL,
    status car_status NOT NULL DEFAULT 'unpaid',
    registration_no VARCHAR(20),
    chasis_no VARCHAR(30),
    engine_no VARCHAR(30),
    date_issued DATE,
    expiry_date DATE,
    document_images JSONB DEFAULT '[]'::jsonb,
    plate_number VARCHAR(20),
    type plate_type,
    preferred_name VARCHAR(100),
    business_type VARCHAR(50),
    cac_document TEXT,
    letterhead TEXT,
    means_of_identification TEXT,
    company_name VARCHAR(100),
    company_address TEXT,
    company_phone VARCHAR(20),
    cac_number VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT valid_registered_car_dates CHECK (
        registration_status = 'unregistered' 
        OR (date_issued IS NOT NULL AND expiry_date IS NOT NULL AND expiry_date > date_issued)
    )
);

CREATE INDEX idx_cars_user_id ON cars(user_id);
CREATE INDEX idx_cars_user_id_registration_no ON cars(user_id, registration_no) WHERE registration_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_cars_user_id_chasis_no ON cars(user_id, chasis_no) WHERE chasis_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_cars_user_id_engine_no ON cars(user_id, engine_no) WHERE engine_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_cars_deleted_at ON cars(deleted_at) WHERE deleted_at IS NULL;

-- Global uniqueness (excluding NULL and soft-deleted records)
CREATE UNIQUE INDEX idx_cars_registration_no_unique ON cars(registration_no) WHERE registration_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_cars_chasis_no_unique ON cars(chasis_no) WHERE chasis_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_cars_engine_no_unique ON cars(engine_no) WHERE engine_no IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION update_cars_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cars_updated_at
    BEFORE UPDATE ON cars
    FOR EACH ROW
    EXECUTE FUNCTION update_cars_updated_at();

ALTER TABLE cars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cars"
    ON cars FOR SELECT
    USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can insert own cars"
    ON cars FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cars"
    ON cars FOR UPDATE
    USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can soft delete own cars"
    ON cars FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access"
    ON cars FOR ALL
    USING (auth.role() = 'service_role');
