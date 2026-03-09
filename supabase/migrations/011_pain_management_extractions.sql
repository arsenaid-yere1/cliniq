-- ============================================
-- ADD PAIN_MANAGEMENT DOCUMENT TYPE
-- ============================================
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'generated', 'other'));

-- ============================================
-- PAIN MANAGEMENT EXTRACTIONS TABLE
-- ============================================
create table public.pain_management_extractions (
  id                  uuid primary key default uuid_generate_v4(),
  document_id         uuid not null references public.documents(id),
  case_id             uuid not null references public.cases(id),

  -- Schema version for future migration
  schema_version      integer not null default 1,

  -- Report metadata (queryable)
  report_date         date,
  date_of_injury      date,
  examining_provider  text,

  -- Structured extraction (JSONB for flexibility)
  chief_complaints    jsonb not null default '[]',
  physical_exam       jsonb not null default '[]',
  diagnoses           jsonb not null default '[]',
  treatment_plan      jsonb not null default '[]',
  diagnostic_studies_summary text,

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
create index idx_pm_extractions_case_id on public.pain_management_extractions(case_id);
create index idx_pm_extractions_document_id on public.pain_management_extractions(document_id);
create index idx_pm_extractions_review_status on public.pain_management_extractions(review_status);
create index idx_pm_extractions_diagnoses on public.pain_management_extractions using gin(diagnoses);
create index idx_pm_extractions_chief_complaints on public.pain_management_extractions using gin(chief_complaints);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create trigger set_updated_at before update on public.pain_management_extractions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.pain_management_extractions enable row level security;

create policy "Authenticated users full access" on public.pain_management_extractions
  for all using (auth.role() = 'authenticated');
