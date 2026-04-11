-- Add visit_type column — separates Initial Visit from Pain Evaluation Visit
-- so both can coexist on the same case as independent rows.
ALTER TABLE initial_visit_notes
ADD COLUMN IF NOT EXISTS visit_type text NOT NULL DEFAULT 'initial_visit'
  CHECK (visit_type IN ('initial_visit', 'pain_evaluation_visit'));

COMMENT ON COLUMN initial_visit_notes.visit_type IS 'Which clinical visit this note represents. Initial Visit (no diagnostics) or Pain Evaluation Visit (imaging reviewed).';

-- Replace the single-row-per-case unique index with one row per (case, visit_type).
-- Prior migrations (010_initial_visit_notes.sql and 20260309194935_*) created:
--   create unique index idx_initial_visit_notes_case_active on initial_visit_notes(case_id) where deleted_at is null
DROP INDEX IF EXISTS idx_initial_visit_notes_case_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_initial_visit_notes_case_visit_type_active
  ON initial_visit_notes(case_id, visit_type)
  WHERE deleted_at IS NULL;
