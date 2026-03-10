-- ============================================
-- ADD PT_REPORT DOCUMENT TYPE
-- ============================================
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'pt_report', 'generated', 'other'));

-- ============================================
-- PT EXTRACTIONS TABLE
-- ============================================
create table public.pt_extractions (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents(id),
  case_id             uuid not null references public.cases(id),

  -- Schema version for future migration
  schema_version      integer not null default 1,

  -- Report metadata (queryable)
  evaluation_date     date,
  date_of_injury      date,
  evaluating_therapist text,
  referring_provider  text,

  -- Subjective (JSONB for flexibility)
  chief_complaint     text,
  mechanism_of_injury text,
  pain_ratings        jsonb not null default '{}',
  functional_limitations text,
  prior_treatment     text,
  work_status         text,

  -- Objective structured extraction (JSONB)
  postural_assessment text,
  gait_analysis       text,
  range_of_motion     jsonb not null default '[]',
  muscle_strength     jsonb not null default '[]',
  palpation_findings  jsonb not null default '[]',
  special_tests       jsonb not null default '[]',
  neurological_screening jsonb not null default '{}',
  functional_tests    jsonb not null default '[]',

  -- Outcome measures
  outcome_measures    jsonb not null default '[]',

  -- Assessment
  clinical_impression text,
  causation_statement text,
  prognosis           text,

  -- Goals
  short_term_goals    jsonb not null default '[]',
  long_term_goals     jsonb not null default '[]',

  -- Plan of care
  plan_of_care        jsonb not null default '{}',

  -- Diagnoses
  diagnoses           jsonb not null default '[]',

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
create index idx_pt_extractions_case_id on public.pt_extractions(case_id);
create index idx_pt_extractions_document_id on public.pt_extractions(document_id);
create index idx_pt_extractions_review_status on public.pt_extractions(review_status);
create index idx_pt_extractions_diagnoses on public.pt_extractions using gin(diagnoses);
create index idx_pt_extractions_outcome_measures on public.pt_extractions using gin(outcome_measures);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create trigger set_updated_at before update on public.pt_extractions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.pt_extractions enable row level security;

create policy "Authenticated users full access" on public.pt_extractions
  for all using (auth.role() = 'authenticated');
