-- B1: procedure_defaults table — anatomy-keyed defaults to replace the
-- global STATIC_PROCEDURE_DEFAULTS block in record-procedure-dialog.
-- C4: procedures.procedure_type column — schema-only this PR (no UI
-- selector yet), unblocks B1 lookup key.
-- B2: procedures.target_structure column — provider-committed target
-- structure that supersedes LLM inference of intradiscal/periarticular
-- language in the procedure note.

-- B1: procedure_defaults table
create table if not exists public.procedure_defaults (
  id uuid primary key default gen_random_uuid(),
  anatomy_key text not null,
  procedure_type text not null check (procedure_type in ('prp', 'cortisone', 'hyaluronic')),
  needle_gauge text,
  injection_volume_ml numeric(6,1),
  anesthetic_agent text,
  anesthetic_dose_ml numeric(6,1),
  guidance_method text check (guidance_method in ('ultrasound', 'fluoroscopy', 'landmark')),
  activity_restriction_hrs integer,
  default_cpt_codes text[] not null default '{}',
  target_structure text check (target_structure in (
    'periarticular', 'facet_capsular', 'intradiscal', 'epidural',
    'transforaminal', 'sacroiliac_adjacent', 'intra_articular'
  )),
  blood_draw_volume_ml numeric(6,1),
  centrifuge_duration_min integer,
  prep_protocol text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anatomy_key, procedure_type)
);

create index if not exists idx_procedure_defaults_lookup
  on public.procedure_defaults (anatomy_key, procedure_type) where active;

-- RLS: read-only to authenticated users; admin-only mutations deferred
alter table public.procedure_defaults enable row level security;

drop policy if exists "procedure_defaults readable by authenticated" on public.procedure_defaults;
create policy "procedure_defaults readable by authenticated"
  on public.procedure_defaults for select
  to authenticated
  using (true);

-- C4: procedure_type column on procedures
alter table public.procedures
  add column if not exists procedure_type text not null default 'prp'
  check (procedure_type in ('prp', 'cortisone', 'hyaluronic'));

-- B2: target_structure column on procedures
alter table public.procedures
  add column if not exists target_structure text
  check (target_structure in (
    'periarticular', 'facet_capsular', 'intradiscal', 'epidural',
    'transforaminal', 'sacroiliac_adjacent', 'intra_articular'
  ));

-- Seed: 8 PRP anatomy rows mirroring current STATIC_PROCEDURE_DEFAULTS,
-- adapted per anatomy. Lumbar facet inherits the existing global defaults
-- (25G spinal, 5 mL, ultrasound). Knee/shoulder/hip use larger gauges and
-- volumes typical for joint injections. CPT composites differ by anatomy
-- (initial seed uses the existing PRP composite for all anatomies; per-
-- anatomy CPT divergence comes later when the catalog is expanded).
insert into public.procedure_defaults
  (anatomy_key, procedure_type, needle_gauge, injection_volume_ml,
   anesthetic_agent, anesthetic_dose_ml, guidance_method,
   activity_restriction_hrs, default_cpt_codes, target_structure,
   blood_draw_volume_ml, centrifuge_duration_min, prep_protocol, notes)
values
  ('lumbar_facet', 'prp', '25-gauge spinal', 5, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'facet_capsular',
   30, 5, 'ACP Double Syringe System', 'Default for lumbar PRP'),
  ('cervical_facet', 'prp', '25-gauge spinal', 3, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'facet_capsular',
   30, 5, 'ACP Double Syringe System', null),
  ('thoracic_facet', 'prp', '25-gauge spinal', 3, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'facet_capsular',
   30, 5, 'ACP Double Syringe System', null),
  ('knee', 'prp', '22-gauge', 5, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null),
  ('shoulder', 'prp', '25-gauge', 4, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null),
  ('hip', 'prp', '22-gauge spinal', 5, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null),
  ('sacroiliac', 'prp', '22-gauge spinal', 4, 'Lidocaine 1%', 2,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'sacroiliac_adjacent',
   30, 5, 'ACP Double Syringe System', null),
  ('ankle', 'prp', '25-gauge', 3, 'Lidocaine 1%', 1.5,
   'ultrasound', 48, ARRAY['0232T', '86999', '76942'], 'intra_articular',
   30, 5, 'ACP Double Syringe System', null)
on conflict (anatomy_key, procedure_type) do nothing;
