-- ============================================
-- EXTEND PROCEDURES TABLE WITH STORY 4.2 FIELDS
-- ============================================

-- PRP Preparation
alter table public.procedures
  add column blood_draw_volume_ml      numeric(6,1),
  add column centrifuge_duration_min   integer,
  add column prep_protocol             text,
  add column kit_lot_number            text;

-- Anesthesia
alter table public.procedures
  add column anesthetic_agent          text,
  add column anesthetic_dose_ml        numeric(6,1),
  add column patient_tolerance         text check (patient_tolerance in ('tolerated_well', 'adverse_reaction'));

-- Injection
alter table public.procedures
  add column injection_volume_ml       numeric(6,1),
  add column needle_gauge              text,
  add column guidance_method           text check (guidance_method in ('ultrasound', 'fluoroscopy', 'landmark')),
  add column target_confirmed_imaging  boolean;

-- Post-Procedure
alter table public.procedures
  add column complications             text,
  add column supplies_used             text,
  add column compression_bandage       boolean,
  add column activity_restriction_hrs  integer;
