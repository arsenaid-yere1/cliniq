-- Add editable visit_date to discharge_notes
alter table public.discharge_notes
  add column visit_date date;

comment on column public.discharge_notes.visit_date is
  'Provider-editable date of the discharge visit. Defaults to the day the note was generated. Falls back to finalized_at::date for pre-existing rows.';
