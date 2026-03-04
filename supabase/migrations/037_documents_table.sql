-- =============================================
-- Migration 037: Documents table for car & driver's license uploads
-- Users upload documents; admin approves/rejects. Supports both car and driver_license.
-- =============================================

CREATE TYPE document_type AS ENUM ('car', 'driver_license');
CREATE TYPE document_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE uploaded_by_type AS ENUM ('user', 'admin');

CREATE TABLE IF NOT EXISTS public.documents (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  car_id BIGINT REFERENCES public.cars(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES public.renewal_orders(id) ON DELETE SET NULL,
  document_type document_type NOT NULL,
  document_category VARCHAR(50),
  file_url TEXT NOT NULL,
  status document_status NOT NULL DEFAULT 'pending',
  uploaded_by_type uploaded_by_type NOT NULL DEFAULT 'user',
  uploaded_by_user_id UUID REFERENCES auth.users(id),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT documents_car_or_driver CHECK (
    (document_type = 'car' AND car_id IS NOT NULL) OR
    (document_type = 'driver_license' AND car_id IS NULL)
  )
);

CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_documents_car_id ON public.documents(car_id) WHERE car_id IS NOT NULL;
CREATE INDEX idx_documents_order_id ON public.documents(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_documents_status ON public.documents(status);
CREATE INDEX idx_documents_document_type ON public.documents(document_type);
CREATE INDEX idx_documents_created_at ON public.documents(created_at DESC);

CREATE TRIGGER trigger_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND uploaded_by_type = 'user');

CREATE POLICY "Service role full access on documents"
  ON public.documents FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);
