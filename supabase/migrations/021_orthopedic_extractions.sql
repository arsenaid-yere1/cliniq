-- ============================================
-- ADD ORTHOPEDIC_REPORT DOCUMENT TYPE
-- ============================================
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'generated', 'other'));

-- ============================================
-- ORTHOPEDIC EXTRACTIONS TABLE
-- ============================================
create table public.orthopedic_extractions (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.documents(id),
  case_id               uuid not null references public.cases(id),

  -- Schema version for future migration
  schema_version        integer not null default 1,

  -- Report metadata (queryable)
  report_date           date,
  date_of_injury        date,
  examining_provider    text,
  provider_specialty    text,

  -- Patient demographics
  patient_age           integer,
  patient_sex           text,
  hand_dominance        text,
  height                text,
  weight                text,
  current_employment    text,

  -- Clinical history (narrative)
  history_of_injury     text,
  past_medical_history  text,
  surgical_history      text,
  previous_complaints   text,
  subsequent_complaints text,
  allergies             text,
  social_history        text,
  family_history        text,

  -- Structured extraction (JSONB for flexibility)
  present_complaints    jsonb not null default '[]',
  current_medications   jsonb not null default '[]',
  physical_exam         jsonb not null default '[]',
  diagnostics           jsonb not null default '[]',
  diagnoses             jsonb not null default '[]',
  recommendations       jsonb not null default '[]',

  -- AI metadata
  ai_model              text,
  ai_confidence         text check (ai_confidence in ('high', 'medium', 'low')),
  extraction_notes      text,
  raw_ai_response       jsonb,

  -- Extraction pipeline
  extraction_status     text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extraction_error      text,
  extraction_attempts   integer not null default 0,
  extracted_at          timestamptz,

  -- Provider review workflow
  review_status         text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'edited', 'rejected')),
  reviewed_by_user_id   uuid references public.users(id),
  reviewed_at           timestamptz,
  provider_overrides    jsonb not null default '{}',

  -- Audit
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by_user_id    uuid references public.users(id),
  updated_by_user_id    uuid references public.users(id)
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_ortho_extractions_case_id on public.orthopedic_extractions(case_id);
create index idx_ortho_extractions_document_id on public.orthopedic_extractions(document_id);
create index idx_ortho_extractions_review_status on public.orthopedic_extractions(review_status);
create index idx_ortho_extractions_diagnoses on public.orthopedic_extractions using gin(diagnoses);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create trigger set_updated_at before update on public.orthopedic_extractions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.orthopedic_extractions enable row level security;

create policy "Authenticated users full access" on public.orthopedic_extractions
  for all using (auth.role() = 'authenticated');
