alter table public.initial_visit_notes
  add column if not exists prp_target_recommendations jsonb not null default '[]'::jsonb,
  add column if not exists prp_target_evidence_hash text;

alter table public.initial_visit_notes
  add constraint initial_visit_notes_prp_targets_array
  check (jsonb_typeof(prp_target_recommendations) = 'array');
