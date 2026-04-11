-- Add editable visit_date to initial_visit_notes
alter table public.initial_visit_notes
  add column visit_date date;

comment on column public.initial_visit_notes.visit_date is
  'Provider-editable date of the initial visit. Defaults to the day the note was generated. Falls back to finalized_at::date for pre-existing rows.';
