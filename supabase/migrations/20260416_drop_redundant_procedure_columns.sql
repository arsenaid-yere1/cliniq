-- Drop unused legacy columns from procedures table.
-- These were part of the original generic schema but are not populated
-- by the PRP procedure workflow and are redundant:
--   cpt_code   — billing uses invoice_line_items, not this column
--   provider_id — provider is resolved via cases.assigned_provider_id
--   notes       — replaced by structured procedure_notes table

alter table public.procedures
  drop column if exists cpt_code,
  drop column if exists provider_id,
  drop column if exists notes;
