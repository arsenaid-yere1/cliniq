-- Add post_accident_history section to initial_visit_notes (15 → 16 sections)
-- Placed after history_of_accident in the clinical document flow

alter table public.initial_visit_notes
  add column post_accident_history text;

comment on column public.initial_visit_notes.post_accident_history is
  'Post-accident treatment timeline, symptom evolution, and functional impact';
