-- Clarify the clinical semantic of vital_signs.pain_score_min/max for
-- rows linked to a procedure. Historically the column was ambiguous
-- ("pain at this encounter") and providers interpreted it
-- inconsistently — some entered pre-injection numbers (check-in vitals
-- flow), others entered post-injection reactions. The canonical
-- convention is now pre-procedure, matching the PRP clinic's standard
-- check-in vitals workflow. Post-injection response is narrated in the
-- procedure note and estimated in the discharge-visit reading via the
-- -2 rule (or entered verbatim when the provider records discharge
-- vitals at the follow-up visit).
--
-- Schema is unchanged; this migration only refreshes the column
-- comments to match the new convention.

comment on column public.vital_signs.pain_score_min is
  'Patient-reported pain score lower bound on 0-10 NRS. When the row is linked to a procedure (procedure_id IS NOT NULL), this is the PRE-INJECTION reading captured at check-in. When the row is a non-procedure reading (procedure_id IS NULL), this is the intake / interim reading.';

comment on column public.vital_signs.pain_score_max is
  'Patient-reported pain score upper bound on 0-10 NRS. Symmetric semantic with pain_score_min: pre-injection when linked to a procedure; intake / interim when unlinked.';
