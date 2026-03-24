-- Remove motor_sensory_reflex column from initial_visit_notes
-- Neurological findings are now included as a paragraph within the physical_exam section
alter table public.initial_visit_notes
  drop column if exists motor_sensory_reflex;
