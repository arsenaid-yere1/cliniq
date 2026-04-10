-- Drop unused patient_header column from procedure_notes
-- This section was merged into the subjective section
alter table public.procedure_notes drop column if exists patient_header;
