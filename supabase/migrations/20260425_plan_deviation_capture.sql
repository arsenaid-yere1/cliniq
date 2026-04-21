-- Plan-vs-performed capture for PRP procedures.
--
-- Two new columns:
--
-- 1. procedures.plan_deviation_reason — free text captured at the encounter
--    form when the performed technique (injection_site, laterality,
--    guidance_method) diverges from the planned treatment on file (PM
--    extraction treatment_plan or initial-visit treatment_plan). Consumed
--    by the PLAN-COHERENCE RULE in the procedure-note generator as the
--    rationale source; eliminates the need for the AI to emit
--    "[confirm rationale for plan deviation: ...]" placeholders.
--
-- 2. procedure_notes.plan_deviation_acknowledged_at — timestamp recorded
--    when the provider explicitly acknowledges an "unplanned" procedure
--    on the note editor before finalization. Finalization is blocked for
--    planAlignment.status = 'unplanned' until this acknowledgement is
--    persisted. Mirrors the existing consent_obtained discipline and
--    provides a dated medico-legal attestation.

ALTER TABLE procedures
  ADD COLUMN IF NOT EXISTS plan_deviation_reason TEXT;

COMMENT ON COLUMN procedures.plan_deviation_reason IS
  'Optional provider-entered rationale for performing the procedure differently from the documented treatment plan (PM extraction treatment_plan or initial-visit treatment_plan). Captured on the procedure encounter form. Read by the PLAN-COHERENCE RULE in procedure-note generation.';

ALTER TABLE procedure_notes
  ADD COLUMN IF NOT EXISTS plan_deviation_acknowledged_at TIMESTAMPTZ;

COMMENT ON COLUMN procedure_notes.plan_deviation_acknowledged_at IS
  'Timestamp of provider acknowledgement that the procedure was unplanned (planAlignment.status = "unplanned"). Required before finalization when the note is flagged unplanned. NULL for aligned / deviation / no_plan_on_file statuses and for unfinalized notes that have not yet been acknowledged.';
