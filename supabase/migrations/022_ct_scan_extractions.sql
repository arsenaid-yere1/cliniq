-- ============================================
-- ADD CT_SCAN DOCUMENT TYPE
-- ============================================
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'other'));

-- ============================================
-- CT SCAN EXTRACTIONS TABLE
-- ============================================
create table public.ct_scan_extractions (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.documents(id),
  case_id               uuid not null references public.cases(id),

  -- Schema version for future migration
  schema_version        integer not null default 1,

  -- Extracted fields (radiology-specific)
  body_region           text,
  scan_date             date,
  technique             text,
  reason_for_study      text,
  findings              jsonb not null default '[]',
  impression_summary    text,

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
create index idx_ct_scan_extractions_case_id on public.ct_scan_extractions(case_id);
create index idx_ct_scan_extractions_document_id on public.ct_scan_extractions(document_id);
create index idx_ct_scan_extractions_review_status on public.ct_scan_extractions(review_status);
create index idx_ct_scan_extractions_findings on public.ct_scan_extractions using gin(findings);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create trigger set_updated_at before update on public.ct_scan_extractions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.ct_scan_extractions enable row level security;

create policy "Authenticated users full access" on public.ct_scan_extractions
  for all using (auth.role() = 'authenticated');
