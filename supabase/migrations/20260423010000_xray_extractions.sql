-- ============================================
-- ADD x_ray DOCUMENT TYPE
-- ============================================
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in (
      'mri_report',
      'chiro_report',
      'pain_management',
      'pt_report',
      'orthopedic_report',
      'ct_scan',
      'x_ray',
      'generated',
      'lien_agreement',
      'procedure_consent',
      'other'
    ));

-- ============================================
-- X-RAY EXTRACTIONS TABLE
-- ============================================
create table public.x_ray_extractions (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.documents(id),
  case_id               uuid not null references public.cases(id),

  schema_version        integer not null default 1,

  -- Extracted fields (X-ray specific)
  body_region           text,
  laterality            text check (laterality in ('left', 'right', 'bilateral')),
  scan_date             date,
  procedure_description text,
  view_count            integer,
  views_description     text,
  reading_type          text check (reading_type in ('formal_radiology', 'in_office_alignment')),
  ordering_provider     text,
  reading_provider      text,
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
create index idx_x_ray_extractions_case_id on public.x_ray_extractions(case_id);
create index idx_x_ray_extractions_document_id on public.x_ray_extractions(document_id);
create index idx_x_ray_extractions_review_status on public.x_ray_extractions(review_status);
create index idx_x_ray_extractions_findings on public.x_ray_extractions using gin(findings);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create trigger set_updated_at before update on public.x_ray_extractions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.x_ray_extractions enable row level security;

create policy "Authenticated users full access" on public.x_ray_extractions
  for all using (auth.role() = 'authenticated');
