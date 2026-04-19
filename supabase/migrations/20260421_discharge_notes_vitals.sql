-- Add provider-entered vital signs to discharge_notes.
-- Recorded at the discharge follow-up visit (a separate encounter after the
-- final PRP injection). When non-null, the generator uses these values verbatim
-- for the objective_vitals bullets and as the endpoint of the pain trajectory,
-- overriding the default "last procedure pain_score_max - 2" rule.

alter table public.discharge_notes
  add column bp_systolic      integer,
  add column bp_diastolic     integer,
  add column heart_rate       integer,
  add column respiratory_rate integer,
  add column temperature_f    numeric(4,1),
  add column spo2_percent     integer check (spo2_percent >= 0 and spo2_percent <= 100),
  add column pain_score_min   integer check (pain_score_min >= 0 and pain_score_min <= 10),
  add column pain_score_max   integer check (pain_score_max >= 0 and pain_score_max <= 10);
