-- Replace initial_visit_notes: expand from 8 to 15 sections matching provider template
-- Safe to drop — no production data exists

drop table if exists public.initial_visit_notes cascade;

create table public.initial_visit_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),

  -- Section text fields (15 sections matching provider template)
  introduction text,
  history_of_accident text,
  chief_complaint text,
  past_medical_history text,
  social_history text,
  review_of_systems text,
  physical_exam text,
  imaging_findings text,
  motor_sensory_reflex text,
  medical_necessity text,
  diagnoses text,
  treatment_plan text,
  patient_education text,
  prognosis text,
  clinician_disclaimer text,

  -- AI metadata
  ai_model text,
  raw_ai_response jsonb,

  -- Note status: generating -> draft -> finalized
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

-- Indexes
create index idx_initial_visit_notes_case_id on public.initial_visit_notes(case_id);
create index idx_initial_visit_notes_status on public.initial_visit_notes(status);

-- One active note per case (soft-delete aware)
create unique index idx_initial_visit_notes_case_active
  on public.initial_visit_notes(case_id) where deleted_at is null;

-- Updated_at trigger (reuse existing function from 001)
create trigger set_updated_at before update on public.initial_visit_notes
  for each row execute function update_updated_at();

-- RLS
alter table public.initial_visit_notes enable row level security;

create policy "Authenticated users full access" on public.initial_visit_notes
  for all using (auth.role() = 'authenticated');
