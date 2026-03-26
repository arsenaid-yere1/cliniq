-- Add provider_intake JSONB column to initial_visit_notes
ALTER TABLE initial_visit_notes
ADD COLUMN IF NOT EXISTS provider_intake jsonb;

COMMENT ON COLUMN initial_visit_notes.provider_intake IS 'Provider-entered intake data: chief complaints, accident details, PMH, social history, exam findings';

-- Create clinical_orders table for companion documents
CREATE TABLE IF NOT EXISTS clinical_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  initial_visit_note_id uuid REFERENCES initial_visit_notes(id),
  order_type text NOT NULL CHECK (order_type IN ('imaging', 'chiropractic_therapy')),
  order_data jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'completed', 'failed')),
  generation_error text,
  ai_model text,
  raw_ai_response jsonb,
  document_id uuid REFERENCES documents(id),
  finalized_by_user_id uuid REFERENCES auth.users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES auth.users(id),
  updated_by_user_id uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_clinical_orders_case_id ON clinical_orders(case_id);
CREATE INDEX idx_clinical_orders_note_id ON clinical_orders(initial_visit_note_id);
CREATE INDEX idx_clinical_orders_type ON clinical_orders(order_type);

-- Updated_at trigger
CREATE TRIGGER set_clinical_orders_updated_at
  BEFORE UPDATE ON clinical_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE clinical_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage clinical_orders"
  ON clinical_orders FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
