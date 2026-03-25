-- Add time & complexity attestation section to initial visit notes
alter table public.initial_visit_notes
  add column time_complexity_attestation text;

comment on column public.initial_visit_notes.time_complexity_attestation is
  'Provider attestation of time spent and complexity of medical decision-making';
