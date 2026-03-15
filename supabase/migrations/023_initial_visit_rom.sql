-- Add ROM data column to initial_visit_notes
-- Stores structured ROM measurements as JSONB (array of region objects)
alter table public.initial_visit_notes
  add column rom_data jsonb;

-- Comment for clarity
comment on column public.initial_visit_notes.rom_data is
  'Structured ROM measurements: [{region, movements: [{movement, normal, actual, pain}]}]';
