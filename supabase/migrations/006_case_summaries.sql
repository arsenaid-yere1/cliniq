-- Case summaries: AI-generated clinical case summaries
-- Follows the same pattern as mri_extractions (004) and chiro_extractions (005)

create table public.case_summaries (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id),

  -- Structured summary fields
  chief_complaint text,
  imaging_findings jsonb not null default '[]',
  prior_treatment jsonb not null default '{}',
  symptoms_timeline jsonb not null default '{}',
  suggested_diagnoses jsonb not null default '[]',

  -- AI metadata (same pattern as extractions)
  ai_model text,
  ai_confidence text check (ai_confidence in ('high', 'medium', 'low')),
  raw_ai_response jsonb,
  extraction_notes text,

  -- Provider review (same pattern as extractions)
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'edited', 'rejected')),
  provider_overrides jsonb not null default '{}',
  reviewed_by_user_id uuid references public.users(id),
  reviewed_at timestamptz,

  -- Generation tracking
  generation_status text not null default 'pending'
    check (generation_status in ('pending', 'processing', 'completed', 'failed')),
  generation_error text,
  generation_attempts integer not null default 0,
  generated_at timestamptz,
  source_data_hash text,

  -- Standard audit fields
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);

-- Indexes
create index idx_case_summaries_case_id on public.case_summaries(case_id);
create index idx_case_summaries_review_status on public.case_summaries(review_status);
create index idx_case_summaries_generation_status on public.case_summaries(generation_status);
create index idx_case_summaries_suggested_diagnoses on public.case_summaries using gin(suggested_diagnoses);

-- Unique constraint: one active summary per case (soft-delete aware)
create unique index idx_case_summaries_case_active on public.case_summaries(case_id) where deleted_at is null;

-- Updated_at trigger (reuse existing function from initial schema)
create trigger set_updated_at before update on public.case_summaries
  for each row execute function update_updated_at();

-- RLS (same pattern as extraction tables)
alter table public.case_summaries enable row level security;

create policy "Authenticated users full access" on public.case_summaries
  for all using (auth.role() = 'authenticated');
