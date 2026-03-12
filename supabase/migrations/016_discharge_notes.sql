create table public.discharge_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),

  -- Note sections (13 sections matching discharge PDF template)
  patient_header         text,  -- Visit metadata line (not prose — used for PDF header)
  subjective             text,  -- Post-PRP follow-up narrative
  objective_vitals       text,  -- Vital signs bullet list
  objective_general      text,  -- General appearance
  objective_cervical     text,  -- Cervical spine examination
  objective_lumbar       text,  -- Lumbar spine examination
  objective_neurological text,  -- Neurological examination
  diagnoses              text,  -- ICD-10 codes with descriptions
  assessment             text,  -- Clinical improvement summary
  plan_and_recommendations text, -- Discharge recommendations
  patient_education      text,  -- Long-term recovery education
  prognosis              text,  -- Prognosis statement
  clinician_disclaimer   text,  -- Medical-legal disclaimer

  -- AI metadata
  ai_model text,
  raw_ai_response jsonb,

  -- Status: generating -> draft -> finalized | failed
  status text not null default 'draft'
    check (status in ('generating', 'draft', 'finalized', 'failed')),
  generation_error text,
  generation_attempts integer not null default 0,
  source_data_hash text,

  -- Provider finalization
  finalized_by_user_id uuid references public.users(id),
  finalized_at timestamptz,

  -- Link to documents table entry (created on finalization)
  document_id uuid references public.documents(id),

  -- Standard audit fields
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);

create index idx_discharge_notes_case_id on public.discharge_notes(case_id);
create index idx_discharge_notes_status  on public.discharge_notes(status);

-- One active discharge note per case (soft-delete aware)
create unique index idx_discharge_notes_case_active
  on public.discharge_notes(case_id) where deleted_at is null;

create trigger set_updated_at before update on public.discharge_notes
  for each row execute function update_updated_at();

alter table public.discharge_notes enable row level security;

create policy "Authenticated users full access" on public.discharge_notes
  for all using (auth.role() = 'authenticated');
