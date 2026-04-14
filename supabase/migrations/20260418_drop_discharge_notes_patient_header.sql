-- Drop unused patient_header column from discharge_notes
-- This section was merged into the subjective section
alter table public.discharge_notes drop column if exists patient_header;
