create table public.procedure_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  procedure_id uuid not null references public.procedures(id),

  -- Note sections
  patient_header         text,
  subjective             text,
  past_medical_history   text,
  allergies              text,
  current_medications    text,
  social_history         text,
  review_of_systems      text,
  objective_vitals       text,
  objective_physical_exam text,
  assessment_summary     text,
  procedure_indication   text,
  procedure_preparation  text,
  procedure_prp_prep     text,
  procedure_anesthesia   text,
  procedure_injection    text,
  procedure_post_care    text,
  procedure_followup     text,
  assessment_and_plan    text,
  patient_education      text,
  prognosis              text,
  clinician_disclaimer   text,

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

create index idx_procedure_notes_case_id      on public.procedure_notes(case_id);
create index idx_procedure_notes_procedure_id on public.procedure_notes(procedure_id);
create index idx_procedure_notes_status       on public.procedure_notes(status);

-- One active note per procedure (soft-delete aware)
create unique index idx_procedure_notes_procedure_active
  on public.procedure_notes(procedure_id) where deleted_at is null;

create trigger set_updated_at before update on public.procedure_notes
  for each row execute function update_updated_at();

alter table public.procedure_notes enable row level security;

create policy "Authenticated users full access" on public.procedure_notes
  for all using (auth.role() = 'authenticated');
