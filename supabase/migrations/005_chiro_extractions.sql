-- ============================================
-- CHIRO EXTRACTIONS TABLE
-- ============================================
create table public.chiro_extractions (
  id                  uuid primary key default uuid_generate_v4(),
  document_id         uuid not null references public.documents(id),
  case_id             uuid not null references public.cases(id),

  -- Schema version for future migration
  schema_version      integer not null default 1,

  -- Report metadata
  report_type         text check (report_type in (
    'initial_evaluation', 'soap_note', 're_evaluation',
    'discharge_summary', 'other'
  )),
  report_date         date,

  -- Structured extraction (JSONB for flexibility)
  treatment_dates     jsonb not null default '{}',
  diagnoses           jsonb not null default '[]',
  treatment_modalities jsonb not null default '[]',
  functional_outcomes jsonb not null default '{}',
  plateau_statement   jsonb not null default '{}',

  -- AI metadata
  ai_model            text,
  ai_confidence       text check (ai_confidence in ('high', 'medium', 'low')),
  extraction_notes    text,
  raw_ai_response     jsonb,

  -- Extraction pipeline
  extraction_status   text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extraction_error    text,
  extraction_attempts integer not null default 0,
  extracted_at        timestamptz,

  -- Provider review workflow
  review_status       text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'edited', 'rejected')),
  reviewed_by_user_id uuid references public.users(id),
  reviewed_at         timestamptz,
  provider_overrides  jsonb not null default '{}',

  -- Audit
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  created_by_user_id  uuid references public.users(id),
  updated_by_user_id  uuid references public.users(id)
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_chiro_extractions_case_id on public.chiro_extractions(case_id);
create index idx_chiro_extractions_document_id on public.chiro_extractions(document_id);
create index idx_chiro_extractions_review_status on public.chiro_extractions(review_status);
create index idx_chiro_extractions_diagnoses on public.chiro_extractions using gin(diagnoses);
create index idx_chiro_extractions_treatment_modalities on public.chiro_extractions using gin(treatment_modalities);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create trigger set_updated_at before update on public.chiro_extractions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.chiro_extractions enable row level security;

create policy "Authenticated users full access" on public.chiro_extractions
  for all using (auth.role() = 'authenticated');
