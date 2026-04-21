-- Snapshot of planAlignment.status on procedure_notes at generation time.
-- Consumed by finalizeProcedureNote to gate finalization when status =
-- 'unplanned' without a provider acknowledgement.

ALTER TABLE procedure_notes
  ADD COLUMN IF NOT EXISTS plan_alignment_status TEXT;

COMMENT ON COLUMN procedure_notes.plan_alignment_status IS
  'Snapshot of planAlignment.status computed when the procedure note was generated. One of "aligned", "deviation", "unplanned", "no_plan_on_file". Used by finalizeProcedureNote to gate finalization when status = "unplanned" without a provider acknowledgement. NULL on notes generated before this column was added.';
